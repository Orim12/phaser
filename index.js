document.addEventListener("DOMContentLoaded", function() {
    // Zoek de knop op basis van het id-attribuut
    var game_button = document.getElementById("game_button");

    // Voeg een click-eventlistener toe aan de knop
    game_button.addEventListener("click", function() {
        // Navigeer naar de gewenste website
        window.location.href = "game.html";
    });
    var Home_button = document.getElementById("Home_button");

    // Voeg een click-eventlistener toe aan de knop
    Home_button.addEventListener("click", function() {
        // Navigeer naar de gewenste website
        window.location.href = "index.html";
    });
})