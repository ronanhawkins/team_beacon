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
        public bool Connected { get; private set; }
        public bool Synthetic { get; private set; }
        public string Error { get; private set; } = "Connecting to laptop";
        public event Action Changed;
        readonly ConcurrentQueue<Action> mainThread = new ConcurrentQueue<Action>();
        readonly SemaphoreSlim sendLock = new SemaphoreSlim(1, 1);
        CancellationTokenSource lifetime;
        ClientWebSocket socket;
        void Start() { lifetime = new CancellationTokenSource(); _ = Run(lifetime.Token); }
        void Update() { while (mainThread.TryDequeue(out var action)) action(); }
        void OnDestroy() { lifetime?.Cancel(); socket?.Abort(); }
        void Publish(Action update) => mainThread.Enqueue(() => { update(); Changed?.Invoke(); });
        async Task Run(CancellationToken cancel)
        {
            int delay = 1000;
            while (!cancel.IsCancellationRequested)
            {
                try
                {
                    RouteDocument route; MissionSession session;
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
                                var next = Contracts.StateFrom(envelope["state"]);
                                var selection = Contracts.Select(next, route);
                                Publish(() => {
                                    bool changed = !Connected || State?.route != next.route || State?.waypointIndex != next.waypointIndex || State?.mode != next.mode;
                                    State = next; Selection = selection; Synthetic = session.synthetic; Connected = true; Error = "";
#if DEVELOPMENT_BUILD || UNITY_EDITOR
                                    if (changed) Debug.Log($"BEACON_STATE: {next.route} {next.waypointIndex} {next.mode} {selection.Point.id}");
#endif
                                });
                            }
                        }
                    }
                }
                catch (OperationCanceledException) when (cancel.IsCancellationRequested) { break; }
                catch (Exception error) { var detail = error.Message; Publish(() => { Connected = false; Selection = null; Error = detail; Debug.LogWarning("BEACON_OFFLINE: " + detail); }); }
                finally { socket = null; }
                try { await Task.Delay(delay, cancel); } catch (OperationCanceledException) { break; }
                delay = Math.Min(delay * 2, 8000);
            }
        }
        async Task SendText(ClientWebSocket ws, string text, CancellationToken cancel)
        {
            await sendLock.WaitAsync(cancel);
            try { await ws.SendAsync(new ArraySegment<byte>(Encoding.UTF8.GetBytes(text)), WebSocketMessageType.Text, true, cancel); }
            finally { sendLock.Release(); }
        }
        public async void RequestShelter()
        {
            var ws = socket;
            if (!Connected || ws?.State != WebSocketState.Open) return;
            try { await SendText(ws, "{\"type\":\"requestReroute\"}", lifetime.Token); }
            catch (Exception error) { Debug.LogWarning("Shelter request failed: " + error.Message); }
        }
    }
}
