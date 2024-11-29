const MILES_TO_METERS = 1609.34;
const MAX_ZONE_DISTANCE = 1 * MILES_TO_METERS; // 3 miles in meters
const N_ZONES = 300;
const ZONE_SIZE = 30; // how close counts as "at" a zone?
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

let gameState = {
    points: 0,
};

let map;
let userMarker;
let checkInZones = [];

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

RNG = splitmix32(getCurrentTimeBlock());

const userMarkerOptions = {
    radius: 8,
    fillColor: "#ff7800",
    color: "#000",
    weight: 1,
    opacity: 1,
    fillOpacity: 0.8,
};

function addUserPoints(change) {
    gameState.points += change;
    document.getElementById('points').textContent = gameState.points;
    saveGameState();
}

function saveGameState() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(gameState));
}

function loadGameState() {
    const savedState = localStorage.getItem(STORAGE_KEY);
    if (savedState) {
        gameState = JSON.parse(savedState);
        document.getElementById('points').textContent = gameState.points;
    }
}

// Generate N random points within a circle, keeping minimum distance between them
function generateRandomPoints(center, radius, n, minDistance = 200) { // minDistance in meters
    const seed = getCurrentTimeBlock();

    const points = [];
    let attempts = 0;
    const maxAttempts = n * 10; // Prevent infinite loops

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

        const newLocations = generateRandomPoints(
            { lat: userPosition.coords.latitude, lng: userPosition.coords.longitude },
            MAX_ZONE_DISTANCE, N_ZONES);

        // Generate new points
        for (let i = 0; i < N_ZONES; i++) {
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
        .bindPopup(`Check-in point: ${points} points`)
        .addTo(map);

    return {
        marker,
        circle,
        points,
        status: ZoneStatus.NORMAL,
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
            handleLocationError,
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
    const lat = position.coords.latitude;
    const lng = position.coords.longitude;

    if (userMarker) {
        userMarker.setLatLng([lat, lng]);
    } else {
        userMarker = L.circleMarker([lat, lng], userMarkerOptions).addTo(map);

        if (!map.getBounds().contains(userMarker.getLatLng())) {
            map.setView([lat, lng], 15);
        }
    }

    // Update zone statuses
    const userLatLng = [lat, lng];
    checkInZones.forEach(zone => {
        const pointLatLng = zone.marker.getLatLng();
        const distance = map.distance(userLatLng, [pointLatLng.lat, pointLatLng.lng]);

        zone.setStatus(distance <= ZONE_SIZE ? ZoneStatus.NEARBY : ZoneStatus.NORMAL);
    });

    console.log("User location updated");
}

function handleLocationError(error) {
    console.error("Error getting location:", error);
}

// Initialize everything when the page loads
document.addEventListener('DOMContentLoaded', () => {
    initMap();

    // Add check-in button listener
    document.getElementById('checkInButton').addEventListener('click', () => {
        if ("geolocation" in navigator) {
            navigator.geolocation.getCurrentPosition(checkIn, handleLocationError);
        }
    });
});

function simulateMovement() {
    if (checkInZones.length === 0) return;

    // Pick a random zone
    const randomIndex = Math.floor(Math.random() * checkInZones.length);
    const targetZone = checkInZones[randomIndex];
    const targetPos = targetZone.marker.getLatLng();

    // Add small random offset (1-3 meters in random direction)
    const offsetAngle = Math.random() * 2 * Math.PI;
    const offsetDistance = 1 + Math.random() * 2; // 1-3 meters
    const offsetLat = (offsetDistance * Math.sin(offsetAngle)) / 111111;
    const offsetLng = (offsetDistance * Math.cos(offsetAngle)) / (111111 * Math.cos(targetPos.lat));

    // Create fake position object matching geolocation API format
    const fakePosition = {
        coords: {
            latitude: targetPos.lat + offsetLat,
            longitude: targetPos.lng + offsetLng,
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
    //checkIn(fakePosition);
}

function checkIn(position) {
    // Find if user is near any check-in points
    const userLatLng = [position.coords.latitude, position.coords.longitude];

    for (let i = 0; i < checkInZones.length; i++) {
        const point = checkInZones[i];
        const pointLatLng = point.marker.getLatLng();
        const distance = map.distance(userLatLng, [pointLatLng.lat, pointLatLng.lng]);

        if (distance <= ZONE_SIZE) {
            addUserPoints(point.points);
            alert(`Checked in! +${point.points} points`);

            point.setStatus('checkedIn');
        }
    }
} 