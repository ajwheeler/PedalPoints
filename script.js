const MILES_TO_METERS = 1609.34;
const ZONE_RADIUS = 1.5 * MILES_TO_METERS; // 3 miles in meters
const N_ZONES = 100;

let userPoints = 0;
let map;
let userMarker;
let checkInZones = [];

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
    const points = [];
    let attempts = 0;
    const maxAttempts = n * 10; // Prevent infinite loops

    while (points.length < n && attempts < maxAttempts) {
        const angle = Math.random() * 2 * Math.PI;
        const distance = Math.sqrt(Math.random()) * radius;

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
    const basePoints = Math.floor(Math.random() * 5) + 1; // random between 1 and 5
    const distanceBonus = Math.floor(distanceMeters / 500); // +1 point per 500m
    return basePoints + distanceBonus;
}

// Clear the zones an generate new ones
function refreshZones(userPosition) {
    console.log("Refreshing zones");
    checkInZones.forEach(point => point.marker.remove());
    checkInZones = [];

    const newLocations = generateRandomPoints(
        { lat: userPosition.coords.latitude, lng: userPosition.coords.longitude }
        , ZONE_RADIUS, N_ZONES)

    // Generate new points
    for (let i = 0; i < N_ZONES; i++) {
        const position = newLocations[i]
        const distance = map.distance(
            [userPosition.coords.latitude, userPosition.coords.longitude],
            [position.lat, position.lng]
        );
        const points = choosePointValues(distance);
        const marker = L.marker([position.lat, position.lng])
            .bindPopup(`Check-in point: ${points} points`)
            .addTo(map);
        checkInZones.push({ marker, points });
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
                    startCountdownTimer();
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

// Add this near the top with other let declarations
let countdownInterval;
let nextRefreshTime;

// Add these new functions
function startCountdownTimer() {
    nextRefreshTime = Date.now() + 15 * 60 * 1000;
    updateCountdown();

    // Clear existing interval if it exists
    if (countdownInterval) clearInterval(countdownInterval);

    countdownInterval = setInterval(() => {
        updateCountdown();

        if (Date.now() >= nextRefreshTime) {
            if (userMarker) {
                const position = {
                    coords: {
                        latitude: userMarker.getLatLng().lat,
                        longitude: userMarker.getLatLng().lng
                    }
                };
                refreshZones(position);
                nextRefreshTime = Date.now() + 15 * 60 * 1000;
            }
        }
    }, 1000);
}

function updateCountdown() {
    const remaining = Math.max(0, nextRefreshTime - Date.now());
    const minutes = Math.floor(remaining / 60000);
    const seconds = Math.floor((remaining % 60000) / 1000);
    document.getElementById('countdown').textContent =
        `Next refresh in: ${minutes}:${seconds.toString().padStart(2, '0')}`;
}

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