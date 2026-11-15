using System;
using System.Collections.Concurrent;
using System.IO;
using System.Net.Http;
using System.Net.WebSockets;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;
using UnityEngine;

namespace Beacon
{
    public sealed class BeaconRelay : MonoBehaviour
    {
        // adb reverse carries this loopback connection over USB. No external host
        // or certificate bypass is needed in the installed Android app.
        public string serverUrl = "http://127.0.0.1:5174";
        public MissionState State { get; private set; }
        public MissionSelection Selection { get; private set; }
        public RouteDocument Document { get; private set; }
        public MissionSite Site { get; private set; }
        public bool Connected { get; private set; }
        public bool Synthetic { get; private set; }
        public string Error { get; private set; } = "Connecting to laptop";
        public event Action Changed;
        // Raised after a new route replaced the old one (a plan from the hub or wrist, or A loading the example route).
        public event Action RouteChanged;
        public event Action SimulationReset;
        public bool SimulationCommandPending => commandReply!=null;
        TaskCompletionSource<bool> commandReply;
        string commandId,commandType;
        float commandDeadline;
        readonly ConcurrentQueue<Action> mainThread = new ConcurrentQueue<Action>();
        readonly SemaphoreSlim sendLock = new SemaphoreSlim(1, 1);
        CancellationTokenSource lifetime;
        ClientWebSocket socket;
        void Start() { lifetime = new CancellationTokenSource(); _ = Run(lifetime.Token); }
        void Update()
        {
            while (mainThread.TryDequeue(out var action)) action();
            if(SimulationCommandPending && Time.unscaledTime>=commandDeadline) CompleteCommand(false);
        }
        void OnDestroy() { CompleteCommand(false); lifetime?.Cancel(); socket?.Abort(); }
        void Publish(Action update) => mainThread.Enqueue(() => { update(); Changed?.Invoke(); });
#if UNITY_EDITOR
        public Func<JObject,Task<bool>> PreviewTransport;
        public void Preview(MissionState state, RouteDocument document, MissionSite site)
        {
            State=state; Document=document; Site=site; Selection=Contracts.Select(state,document); Connected=true; Changed?.Invoke();
        }
        public void PreviewOffline() { Connected=false; Selection=null; CompleteCommand(false); Changed?.Invoke(); }
        public void PreviewCommandReply(string id) => ConfirmCommand(id);
#endif
        async Task Run(CancellationToken cancel)
        {
            int delay = 1000;
            while (!cancel.IsCancellationRequested)
            {
                try
                {
                    RouteDocument route; MissionSession session; MissionSite site = null;
                    using (var http = new HttpClient { Timeout = TimeSpan.FromSeconds(8) })
                    {
                        var root = new Uri(serverUrl.TrimEnd('/') + "/");
                        using (var response = await http.GetAsync(new Uri(root, "session.json"), cancel))
                        { response.EnsureSuccessStatusCode(); session = JsonConvert.DeserializeObject<MissionSession>(await response.Content.ReadAsStringAsync()); }
                        if (session?.version != 1 || string.IsNullOrEmpty(session.waypoints)) throw new InvalidDataException("Invalid mission session");
                        var routeUri = new Uri(root, session.waypoints);
                        if (routeUri.Authority != root.Authority || routeUri.Scheme != root.Scheme) throw new InvalidDataException("Route must come from the same mission server");
                        using (var response = await http.GetAsync(routeUri, cancel))
                        { response.EnsureSuccessStatusCode(); route = JsonConvert.DeserializeObject<RouteDocument>(await response.Content.ReadAsStringAsync()); }
                        Contracts.Validate(route);
                        // Optional credit metadata never prevents the live HUD connecting.
                        try
                        {
                            using (var response = await http.GetAsync(new Uri(root, "data/site.json"), cancel))
                                if (response.IsSuccessStatusCode) site = JsonConvert.DeserializeObject<MissionSite>(await response.Content.ReadAsStringAsync());
                        }
                        catch (Exception) when (!cancel.IsCancellationRequested) { }
                    }
                    using (var ws = new ClientWebSocket())
                    {
                        socket = ws;
                        var endpoint = new UriBuilder(serverUrl) { Scheme = serverUrl.StartsWith("https:") ? "wss" : "ws", Path = "/ws" }.Uri;
                        await ws.ConnectAsync(endpoint, cancel);
                        await SendText(ws, "{\"type\":\"hello\",\"role\":\"headset-unity\",\"version\":1}", cancel);
                        delay = 1000;
                        var buffer = new byte[16384];
                        while (ws.State == WebSocketState.Open && !cancel.IsCancellationRequested)
                        {
                            using (var message = new MemoryStream())
                            {
                                WebSocketReceiveResult result;
                                do
                                {
                                    result = await ws.ReceiveAsync(new ArraySegment<byte>(buffer), cancel);
                                    if (result.MessageType == WebSocketMessageType.Close) throw new IOException("Laptop connection closed");
                                    message.Write(buffer, 0, result.Count);
                                    if (message.Length > 1024 * 1024) throw new InvalidDataException("Mission message too large");
                                } while (!result.EndOfMessage);
                                var envelope = JObject.Parse(Encoding.UTF8.GetString(message.ToArray()));
                                if ((string)envelope["type"] != "state") continue;
                                // A new plan (or the example route) replaced the route: fetch it before reading the state against it
                                // (shared/state.md, plan.routeId). The socket stays open, so a pending A/B reply is not lost.
                                var routeIdToken = envelope["state"]?["plan"]?["routeId"];
                                int? routeId = routeIdToken == null || routeIdToken.Type == JTokenType.Null ? (int?)null : (int)routeIdToken;
                                bool newRoute = routeId != session.planId;
                                if (newRoute)
                                {
                                    route = await LoadRoute(new Uri(serverUrl.TrimEnd('/') + "/"), session.waypoints, cancel);
                                    session.planId = routeId;
                                }
                                var next = Contracts.StateFrom(envelope["state"]);
                                var selection = Contracts.Select(next, route);
                                var routeNow = route;
                                Publish(() => {
                                    bool changed = newRoute || !Connected || State?.route != next.route || State?.waypointIndex != next.waypointIndex || State?.mode != next.mode;
                                    State = next; Selection = selection; Document = routeNow; Site = site; Synthetic = session.synthetic; Connected = true; Error = "";
                                    if (newRoute) { Debug.Log("BEACON_ROUTE: new route from the laptop"); RouteChanged?.Invoke(); }
                                    ConfirmCommand((string)envelope["replyTo"]);
#if DEVELOPMENT_BUILD || UNITY_EDITOR
                                    if (changed) Debug.Log($"BEACON_STATE: {next.route} {next.waypointIndex} {next.mode} {selection.Point.id}");
#endif
                                });
                            }
                        }
                    }
                }
                catch (OperationCanceledException) when (cancel.IsCancellationRequested) { break; }
                catch (Exception error) { var detail = error.Message; Publish(() => { Connected = false; Selection = null; CompleteCommand(false); Error = detail; Debug.LogWarning("BEACON_OFFLINE: " + detail); }); }
                finally { socket = null; }
                try { await Task.Delay(delay, cancel); } catch (OperationCanceledException) { break; }
                delay = Math.Min(delay * 2, 8000);
            }
        }
        static async Task<RouteDocument> LoadRoute(Uri root, string path, CancellationToken cancel)
        {
            var routeUri = new Uri(root, path);
            if (routeUri.Authority != root.Authority || routeUri.Scheme != root.Scheme) throw new InvalidDataException("Route must come from the same mission server");
            using (var http = new HttpClient { Timeout = TimeSpan.FromSeconds(8) })
            using (var response = await http.GetAsync(routeUri, cancel))
            {
                response.EnsureSuccessStatusCode();
                var route = JsonConvert.DeserializeObject<RouteDocument>(await response.Content.ReadAsStringAsync());
                Contracts.Validate(route);
                return route;
            }
        }
        async Task SendText(ClientWebSocket ws, string text, CancellationToken cancel)
        {
            await sendLock.WaitAsync(cancel);
            try { await ws.SendAsync(new ArraySegment<byte>(Encoding.UTF8.GetBytes(text)), WebSocketMessageType.Text, true, cancel); }
            finally { sendLock.Release(); }
        }
        JObject Expected() => new JObject { ["route"]=State.route,["waypointIndex"]=State.waypointIndex,["rerouteFrom"]=State.rerouteFrom.HasValue ? (JToken)State.rerouteFrom.Value:JValue.CreateNull() };
        public Task<bool> RequestShelter(int? mainIndex=null)
        {
            var message=new JObject {["type"]="requestReroute"};
            if(mainIndex.HasValue && State!=null) {message["atIndex"]=mainIndex.Value;message["expected"]=Expected();}
            return SendEvent(message);
        }
        public Task<bool> AdvanceWaypoint()
        {
            if(State==null || SimulationCommandPending) return Task.FromResult(false);
            return SendEvent(new JObject {["type"]="next",["expected"]=Expected()});
        }
        public Task<bool> TriggerStorm(int? mainIndex=null) => SimulationCommand("storm",mainIndex);
        public Task<bool> StopStorm() => SimulationCommand("stopStorm",null);
        public Task<bool> ResetSimulation() => SimulationCommand("reset",null);
        async Task<bool> SimulationCommand(string type,int? mainIndex)
        {
            if(!Connected || State==null) return false;
            if(SimulationCommandPending)
            {
                if(type!="reset") return false;
                CompleteCommand(false); // A supersedes an in-flight B request.
            }
            commandId=Guid.NewGuid().ToString("N");commandType=type;
            commandReply=new TaskCompletionSource<bool>();commandDeadline=Time.unscaledTime+5;
            var reply=commandReply;
            var message=new JObject {["type"]=type=="stopStorm" ? "storm":type,["requestId"]=commandId};
            // A starts the example route from the beginning, putting it back if a plan from the hub or wrist replaced it.
            if(type=="reset") message["example"]=true;
            if(type=="storm" || type=="stopStorm")
            {
                message["on"]=type=="storm";message["expected"]=Expected();
                if(mainIndex.HasValue && State.route=="main") message["atIndex"]=mainIndex.Value;
            }
            bool sent=await SendEvent(message);
            if(!sent && commandReply==reply) CompleteCommand(false);
            return await reply.Task;
        }
        void ConfirmCommand(string id)
        {
            if(commandReply==null || id!=commandId) return;
            bool confirmed=commandType=="storm" ? State?.storm==true : commandType=="stopStorm" ? State?.storm==false : State?.route=="main" && State.waypointIndex==0 && !State.storm && !State.panic && !State.rerouteRequested;
            CompleteCommand(confirmed);
        }
        void CompleteCommand(bool success)
        {
            var reply=commandReply;bool reset=commandType=="reset";
            commandReply=null;commandId=null;commandType=null;
            if(reply==null) return;
            if(success && reset) SimulationReset?.Invoke();
            reply.TrySetResult(success);
        }
        async Task<bool> SendEvent(JObject message)
        {
#if UNITY_EDITOR
            if(PreviewTransport!=null) return await PreviewTransport(message);
#endif
            var ws = socket;
            if (!Connected || ws?.State != WebSocketState.Open) return false;
            try { await SendText(ws,message.ToString(Formatting.None),lifetime.Token); return true; }
            catch (Exception error) { Debug.LogWarning("Mission request failed: " + error.Message); return false; }
        }
    }
}
