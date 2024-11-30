const MILES_TO_METERS = 1609.34;
const MAX_ZONE_DISTANCE = 1 * MILES_TO_METERS; // 3 miles in meters
const N_ZONES = 200;
const ZONE_SIZE = 40; // how close counts as "at" a zone?
const STORAGE_KEY = 'PedalPointsGameState';

const ZoneStatus = {
    NORMAL: 'normal',
    NEARBY: 'nearby',
    COLORS: {
        normal: {
            background: '#1db77e',
            border: '#228B22'
        },
        nearby: {
            background: '#3774be',
            border: '#1b62b8'
        },
        checkedIn: {
            background: '#006400',
            border: '#004200'
        }
    }
};

const userMarkerOptions = {
    icon: L.divIcon({
        html: '🚲',
        className: 'bike-marker',
        iconSize: [30, 30],
        iconAnchor: [15, 15]
    })
};

let map;
let userMarker;
let cachedUserPosition = null;
let checkInZones = [];

let gameState = {
    points: 0,
    checkIns: 0,
    multiplier: 1
};
function saveGameState() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(gameState));
}

function loadGameState() {
    const savedState = localStorage.getItem(STORAGE_KEY);
    if (savedState) {
        gameState = JSON.parse(savedState);
        document.getElementById('points').textContent = gameState.points;
        document.getElementById('checkIns').textContent = gameState.checkIns;
        document.getElementById('multiplier').textContent = gameState.multiplier + 'x';
    }
}

function splitmix32(a) {
    return function () {
        a |= 0;
        a = a + 0x9e3779b9 | 0;
        let t = a ^ a >>> 16;
        t = Math.imul(t, 0x21f0aaad);
        t = t ^ t >>> 15;
        t = Math.imul(t, 0x735a2d97);
        return ((t = t ^ t >>> 15) >>> 0) / 4294967296;
    }
}

function getCurrentTimeBlock() {
    console.log("Getting current time block");
    const now = new Date();
    // Round to nearest 15 minutes
    const minutes = now.getMinutes();
    const roundedMinutes = Math.floor(minutes / 15) * 15;
    now.setMinutes(roundedMinutes, 0, 0);
    console.log("Current time block:", now.getTime());
    return now.getTime();
}

let RNG = splitmix32(getCurrentTimeBlock());


function addUserPoints(change) {
    gameState.points += change;
    gameState.checkIns += 1;
    document.getElementById('points').textContent = gameState.points;
    document.getElementById('checkIns').textContent = gameState.checkIns;
    document.getElementById('multiplier').textContent = gameState.multiplier + 'x';
    saveGameState();
}

// Generate N random points within a circle, keeping minimum distance between them
function generateRandomZones(center, radius, n, minDistance = 100) { // minDistance in meters
    const points = [];
    let attempts = 0;
    const maxAttempts = n * 100; // Prevent infinite loops

    while (points.length < n && attempts < maxAttempts) {
        const angle = RNG() * 2 * Math.PI;
        const distance = Math.sqrt(RNG()) * radius;

        const dx = distance * Math.cos(angle);
        const dy = distance * Math.sin(angle);

        // Convert to latitude/longitude
        const newLat = center.lat + (dy / 111111);
        const newLng = center.lng + (dx / (111111 * Math.cos(center.lat)));

        // Check distance from all existing points
        let tooClose = false;
        for (const point of points) {
            const d = Math.sqrt(
                Math.pow((newLat - point.lat) * 111111, 2) +
                Math.pow((newLng - point.lng) * 111111 * Math.cos(center.lat), 2)
            );
            if (d < minDistance) {
                tooClose = true;
                break;
            }
        }

        if (!tooClose) {
            points.push({ lat: newLat, lng: newLng });
        }

        attempts++;
    }
    console.log("Generated", points.length, "points with", attempts, "attempts");
    return points;
}

function choosePointValues(distanceMeters) {
    const basePoints = Math.floor(RNG() * 5) + 1; // random between 1 and 5
    const distanceBonus = Math.floor(distanceMeters / 500); // +1 point per 500m
    return basePoints + distanceBonus;
}

// Clear the zones an generate new ones
function refreshZones(userPosition) {
    const currentBlock = getCurrentTimeBlock();

    // Only refresh if we're in a new time block
    if (checkInZones.timeBlock !== currentBlock) {
        console.log("Refreshing zones for new time block");
        checkInZones.forEach(point => point.remove());
        checkInZones = [];

        const newLocations = generateRandomZones(
            { lat: userPosition.coords.latitude, lng: userPosition.coords.longitude },
            MAX_ZONE_DISTANCE, N_ZONES);

        // Generate new points.
        // Use newLocations.length, not N_ZONES, because we may not have 
        // been able to generate N_ZONES points.
        for (let i = 0; i < newLocations.length; i++) {
            const position = newLocations[i]
            const distance = map.distance(
                [userPosition.coords.latitude, userPosition.coords.longitude],
                [position.lat, position.lng]
            );
            const points = choosePointValues(distance);

            const zone = createZone(position, points);
            checkInZones.push(zone);
        }

        // Store the current time block
        checkInZones.timeBlock = currentBlock;
    }
}

function createZone(position, points) {
    // Create a custom icon with points displayed
    const icon = L.divIcon({
        className: 'custom-marker',
        html: `<div style="background: ${ZoneStatus.COLORS.normal.background}; padding: 3px; border-radius: 10px; border: 2px solid ${ZoneStatus.COLORS.normal.border}; color: white; font-weight: bold; text-align: center; min-width: 20px;">${points}</div>`,
        iconSize: [30, 25],
        iconAnchor: [15, 12]
    });

    // Add a circle to show the check-in zone
    const circle = L.circle([position.lat, position.lng], {
        radius: ZONE_SIZE,
        color: ZoneStatus.COLORS.normal.border,
        fillColor: ZoneStatus.COLORS.normal.background,
        fillOpacity: 0.2,
        weight: 1
    }).addTo(map);

    const marker = L.marker([position.lat, position.lng], { icon: icon })
        .addTo(map);

    // Add checkedIn property to track check-in status
    const zone = {
        marker,
        circle,
        points,
        status: ZoneStatus.NORMAL,
        checkedIn: false,
        setStatus(newStatus) {
            if (!(newStatus in ZoneStatus.COLORS)) return;

            this.status = newStatus;
            const colors = ZoneStatus.COLORS[newStatus];

            // Update marker colors
            const iconElement = this.marker.getElement();
            if (iconElement) {
                const div = iconElement.querySelector('div');
                div.style.background = colors.background;
                div.style.borderColor = colors.border;
            }

            // Update circle colors
            this.circle.setStyle({
                color: colors.border,
                fillColor: colors.background
            });
        },
        remove() {
            this.marker.remove();
            this.circle.remove();
        }
    };

    return zone;
}

function initMap() {
    loadGameState();
    // Initialize map centered on NYC
    map = L.map('map').setView([40.7128, -74.0060], 13);

    // Add OpenStreetMap tiles
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '© OpenStreetMap contributors'
    }).addTo(map);

    if ("geolocation" in navigator) {
        navigator.geolocation.watchPosition(
            (position) => {
                updateUserLocation(position);
                // Initial zone generation when we first get user location
                if (checkInZones.length === 0) {
                    refreshZones(position);
                }
            },
            (error) => console.error("Error getting location:", error),
            {
                enableHighAccuracy: true,
                maximumAge: 30000,
                timeout: 27000
            }
        );
    } else {
        alert("Geolocation is not supported by this browser.");
    }
    console.log("Map initialized");
}

function updateUserLocation(position) {
    const pos = [position.coords.latitude, position.coords.longitude];
    cachedUserPosition = position;

    if (userMarker) {
        userMarker.setLatLng(pos);
    } else { // first time we've seen the user, add the marker
        userMarker = L.marker(pos, userMarkerOptions).addTo(map);
        if (!map.getBounds().contains(userMarker.getLatLng())) {
            map.setView(pos, 15);
        }
    }

    // Update zone statuses and check if any are nearby
    let hasNearbyZones = false;

    checkInZones.forEach(zone => {
        const pointLatLng = zone.marker.getLatLng();
        const distance = map.distance(pos, [pointLatLng.lat, pointLatLng.lng]);
        const isNearby = distance <= ZONE_SIZE;
        zone.setStatus(isNearby ? ZoneStatus.NEARBY : ZoneStatus.NORMAL);

        if (isNearby && !zone.checkedIn) {
            hasNearbyZones = true;
        }
    });

    // Show/hide check-in button based on nearby zones
    const checkInButton = document.getElementById('checkInButton');
    checkInButton.style.display = hasNearbyZones ? 'block' : 'none';

    console.log("User location updated");
}

function checkIn(position) {
    console.log("Checking in");
    const userLatLng = [position.coords.latitude, position.coords.longitude];

    for (let i = 0; i < checkInZones.length; i++) {
        const point = checkInZones[i];
        const pointLatLng = point.marker.getLatLng();
        const distance = map.distance(userLatLng, [pointLatLng.lat, pointLatLng.lng]);

        if (distance <= ZONE_SIZE && !point.checkedIn) {
            console.log("within range for a zone!")
            point.checkedIn = true;
            addUserPoints(point.points);
            alert(`Checked in! +${point.points} points`);

            point.setStatus('checkedIn');
        }
    }
    console.log("done checking in");
}

// Initialize everything when the page loads
document.addEventListener('DOMContentLoaded', () => {
    initMap();

    const checkInButton = document.getElementById('checkInButton');
    if (checkInButton) {
        checkInButton.addEventListener('click', () => {
            console.log('Check-in button clicked');
            if (cachedUserPosition) {
                checkIn(cachedUserPosition);
            } else {
                alert("Please wait for your location to be determined.");
            }
        });
    } else {
        console.error('Check-in button not found in DOM');
    }
});

// ----------------------------------------------------------------
// testing stuff
// ----------------------------------------------------------------

function simulateMovement() {
    if (checkInZones.length === 0) return;

    // Pick a random zone
    const randomIndex = Math.floor(Math.random() * checkInZones.length);
    const targetZone = checkInZones[randomIndex];
    const targetPos = targetZone.marker.getLatLng();

    // Create fake position object matching geolocation API format
    const fakePosition = {
        coords: {
            latitude: targetPos.lat,
            longitude: targetPos.lng,
            accuracy: 10,
            altitude: null,
            altitudeAccuracy: null,
            heading: null,
            speed: null
        },
        timestamp: Date.now()
    };

    // Update user location and trigger check-in
    updateUserLocation(fakePosition);
}