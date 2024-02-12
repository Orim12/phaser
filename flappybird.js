var config = {
    type: Phaser.AUTO,
    width: 400,
    height: 600,
    physics: {
        default: 'arcade',
        arcade: {
            gravity: { y: 300 },
            debug: false,
        },
    },
    scene: {
        preload: preload,
        create: create,
        update: update,
    },
};

var player;
var pipes;
var cursors;
var score = 0;
var scoreText;

var game = new Phaser.Game(config);

function preload() {
    this.load.image('sky', 'pictures/background.png');
    this.load.image('bird', 'path/to/your/bird/image.png');
    this.load.image('pipe', 'path/to/your/pipe/image.png');
}

function create() {
    this.add.image(200, 300, 'sky');

    pipes = this.physics.add.group();

    player = this.physics.add.sprite(100, 300, 'bird');
    player.setCollideWorldBounds(true);

    this.physics.add.collider(player, pipes, hitPipe, null, this);

    cursors = this.input.keyboard.createCursorKeys();

    // Display the score
    scoreText = this.add.text(16, 16, 'Score: 0', { fontSize: '32px', fill: '#000' });

    // Add gravity to the bird
    player.body.gravity.y = 800;

    // Timer to spawn pipes
    this.time.addEvent({ delay: 1500, callback: spawnPipes, callbackScope: this, loop: true });
}

function update() {
    if (cursors.space.isDown && player.body.touching.down) {
        player.setVelocityY(-400);
    }
}

function spawnPipes() {
    var pipe = pipes.create(400, Phaser.Math.Between(100, 500), 'pipe');
    pipe.setVelocityX(-200);

    // Remove pipes when they go out of the screen
    this.physics.world.on('worldbounds', function (body) {
        if (body.gameObject === pipe && body.blocked.left) {
            pipe.destroy();
            incrementScore();
        }
    });
}

function hitPipe() {
    // Game over logic
    this.physics.pause();
    player.setTint(0xff0000);
    player.anims.play('turn');
    gameOverText = this.add.text(100, 250, 'Game Over', { fontSize: '48px', fill: '#000' });
    gameOverText.setDepth(1);
}

function incrementScore() {
    score += 1;
    scoreText.setText('Score: ' + score);
}
