const MILES_TO_METERS = 1609.34;
const ZONE_RADIUS = 3 * MILES_TO_METERS; // 3 miles in meters
const N_ZONES = 1000;

let userPoints = 0;
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
    fillOpacity: 0.8
};

function addUserPoints(change) {
    userPoints += change;
    document.getElementById('points').textContent = userPoints;
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
        checkInZones.forEach(point => point.marker.remove());
        checkInZones = [];

        const newLocations = generateRandomPoints(
            { lat: userPosition.coords.latitude, lng: userPosition.coords.longitude },
            ZONE_RADIUS, N_ZONES);

        // Generate new points
        for (let i = 0; i < N_ZONES; i++) {
            const position = newLocations[i]
            const distance = map.distance(
                [userPosition.coords.latitude, userPosition.coords.longitude],
                [position.lat, position.lng]
            );
            const points = choosePointValues(distance);

            // Create a custom icon with points displayed
            const icon = L.divIcon({
                className: 'custom-marker',
                html: `<div style="background: #ff69b4; padding: 3px; border-radius: 10px; border: 2px solid #ff1493; color: white; font-weight: bold; text-align: center; min-width: 20px;">${points}</div>`,
                iconSize: [30, 25],
                iconAnchor: [15, 12]
            });

            const marker = L.marker([position.lat, position.lng], { icon: icon })
                .bindPopup(`Check-in point: ${points} points`)
                .addTo(map);
            checkInZones.push({ marker, points });
        }

        // Store the current time block
        checkInZones.timeBlock = currentBlock;
    }
}

function initMap() {
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
    // Check if user is near any check-in points
    //checkIn(position);

    console.log("User location updated");
}

function handleLocationError(error) {
    console.error("Error getting location:", error);
}

// Initialize everything when the page loads
document.addEventListener('DOMContentLoaded', initMap);



function checkIn(position) {
    // Find if user is near any check-in points
    const userLatLng = [position.coords.latitude, position.coords.longitude];

    for (let i = 0; i < checkInZones.length; i++) {
        const point = checkInZones[i];
        const pointLatLng = point.marker.getLatLng();
        const distance = map.distance(userLatLng, [pointLatLng.lat, pointLatLng.lng]);

        if (distance <= 50) { // Within 50 meters
            addUserPoints(point.points);
            alert(`Checked in! +${point.points} points`);

            // Remove this check-in point
            point.marker.remove();
            checkInZones.splice(i, 1);

            // Generate a new point to replace it
            refreshZones(position);
            break;
        }
    }
} 