"""Synthetic scene shared by the fake-data generators.

One flat plain with one round butte, plus a Sun, Earth, base and shelter.
Both make_fake_waypoints.py and make_fake_layers.py read this, so the fake
route and the fake map layers describe the same place.

Conventions follow shared/conventions.md: local frame in metres (x east,
y north), azimuth in degrees from north clockwise, elevation in degrees.
"""

import math

SKYLINE_SAMPLES = 72
AZ_STEP = 360 / SKYLINE_SAMPLES

# Terrain crop: 256 px at 4 m/px = 1024 m square.
CROP_PX = 256
METRES_PER_PIXEL = 4

# Butte: a round mesa.
BUTTE_CENTRE = (600.0, 500.0)
BUTTE_HEIGHT = 11.0
# Shelter sits this far from the butte wall, chosen so the wall rises to 35 deg.
SHELTER_GAP = BUTTE_HEIGHT / math.tan(math.radians(35))
# Radius chosen so the butte spans 120 deg of azimuth (half-width 60) at the shelter.
BUTTE_RADIUS = math.sin(math.radians(60)) * SHELTER_GAP / (1 - math.sin(math.radians(60)))

GROUND_Z = -4431.2

SUN = {"az": 115.0, "el": 40.0}
EARTH = {"az": 75.0, "el": 18.0}
BASE_POS = (900.0, 380.0)

WALK_SPEED_M_PER_MIN = 20.0
SCIENCE_STOP_DWELL_MIN = 3.0
DOSE_PER_MIN_OPEN_SKY = 0.008  # dose fraction per minute under a fully open sky
OXYGEN_PER_MIN = 0.006

EARTH_DELAY_MINUTES = 14


def bearing(frm, to):
    """Compass azimuth in degrees from point frm to point to (x east, y north)."""
    return math.degrees(math.atan2(to[0] - frm[0], to[1] - frm[1])) % 360


def distance(a, b):
    return math.hypot(b[0] - a[0], b[1] - a[1])


def offset(origin, az_deg, dist):
    a = math.radians(az_deg)
    return (origin[0] + dist * math.sin(a), origin[1] + dist * math.cos(a))


def nearest_index(az):
    """Skyline index nearest to an azimuth. Same rule as tools/check_fakes.py."""
    return int(az / AZ_STEP + 0.5) % SKYLINE_SAMPLES


def inside_butte(pos):
    return distance(pos, BUTTE_CENTRE) <= BUTTE_RADIUS


def terrain_z(pos):
    """Gentle rise towards the butte, then the butte top."""
    d = distance(pos, BUTTE_CENTRE)
    if d <= BUTTE_RADIUS:
        return GROUND_Z + 2.0 + BUTTE_HEIGHT
    return GROUND_Z + 2.0 * math.exp(-(d - BUTTE_RADIUS) / 80.0)


def base_horizon(az):
    """Distant crater rim, 1 to 3 degrees all round."""
    a = math.radians(az)
    return 2.0 + 0.8 * math.cos(a - math.radians(200)) + 0.2 * math.cos(3 * a)


def _smoothstep(t):
    t = max(0.0, min(1.0, t))
    return t * t * (3 - 2 * t)


def butte_elevation(pos, az):
    """Elevation angle of the butte wall seen from pos in direction az (0 if none)."""
    d = distance(pos, BUTTE_CENTRE)
    if d <= BUTTE_RADIUS:
        return 0.0  # standing on top
    centre_az = bearing(pos, BUTTE_CENTRE)
    half_width = math.degrees(math.asin(BUTTE_RADIUS / d))
    theta = (az - centre_az + 180) % 360 - 180
    if abs(theta) >= half_width:
        return 0.0
    t = math.radians(theta)
    # Distance along the ray to the near wall of the cylinder.
    s = d * math.cos(t) - math.sqrt(max(0.0, BUTTE_RADIUS**2 - (d * math.sin(t)) ** 2))
    el = math.degrees(math.atan2(BUTTE_HEIGHT, s))
    # Soften the edges so neighbouring skylines blend smoothly.
    return el * _smoothstep((half_width - abs(theta)) / (0.25 * half_width))


def skyline(pos, decimals=1):
    out = []
    for i in range(SKYLINE_SAMPLES):
        az = i * AZ_STEP
        v = max(base_horizon(az), butte_elevation(pos, az))
        out.append(round(v, decimals) if decimals is not None else v)
    return out


def open_sky(sky):
    """1 - mean(sin(elevation)), negative elevations treated as 0."""
    return 1 - sum(math.sin(math.radians(max(0.0, e))) for e in sky) / len(sky)


def clears(sky, az, el):
    return el > sky[nearest_index(az)]


def base_visible(pos):
    """Line of sight to base: blocked if the segment crosses the butte."""
    if inside_butte(pos):
        return True
    (px, py), (bx, by), (cx, cy) = pos, BASE_POS, BUTTE_CENTRE
    dx, dy = bx - px, by - py
    seg2 = dx * dx + dy * dy
    if seg2 == 0:
        return True  # standing at base
    t = max(0.0, min(1.0, ((cx - px) * dx + (cy - py) * dy) / seg2))
    closest = (px + t * dx, py + t * dy)
    return distance(closest, BUTTE_CENTRE) > BUTTE_RADIUS


# The shelter is beside the butte, at the end of the main route.
SHELTER_BEARING_FROM_BUTTE = 255.0
SHELTER_POS = offset(BUTTE_CENTRE, SHELTER_BEARING_FROM_BUTTE, BUTTE_RADIUS + SHELTER_GAP)
