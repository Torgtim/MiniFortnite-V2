const canvas = document.getElementById("gameCanvas");
const ctx = canvas.getContext("2d");

const W = canvas.width;
const H = canvas.height;

// ---------- INPUT ----------
const keys = {};
let mouse = { x: 0, y: 0, down: false };

window.addEventListener("keydown", e => keys[e.key.toLowerCase()] = true);
window.addEventListener("keyup", e => keys[e.key.toLowerCase()] = false);

canvas.addEventListener("mousemove", e => {
    const rect = canvas.getBoundingClientRect();
    mouse.x = e.clientX - rect.left;
    mouse.y = e.clientY - rect.top;
});

canvas.addEventListener("mousedown", () => mouse.down = true);
canvas.addEventListener("mouseup", () => mouse.down = false);

// ---------- GAME DATA ----------

const WEAPONS = [
    { name: "Pistol", damage: 15, fireRate: 0.4, bulletSpeed: 7, spread: 0.05 },
    { name: "Shotgun", damage: 10, fireRate: 0.8, bulletSpeed: 6, pellets: 6, spread: 0.4 },
    { name: "Sniper", damage: 60, fireRate: 1.2, bulletSpeed: 10, spread: 0.01 },
    { name: "SMG", damage: 8, fireRate: 0.15, bulletSpeed: 7, spread: 0.12 },
    { name: "Grenade", damage: 40, fireRate: 1.5, grenade: true, radius: 60 }
];

const PLAYER_SPEED = 2.2;
const SPRINT_MULT = 1.7;
const ENERGY_MAX = 100;
const ENERGY_DRAIN = 25; // per sekund
const ENERGY_REGEN = 15; // per sekund

const BOT_COUNT = 6;
const BUILDING_COUNT = 18;
const LOOT_COUNT = 14;

const STORM_START_RADIUS = 600;
const STORM_END_RADIUS = 80;
const STORM_DURATION = 180; // sekunder
const STORM_DPS = 5;

// ---------- ENTITIES ----------

function createPlayer() {
    return {
        x: W / 2,
        y: H / 2,
        r: 14,
        hp: 100,
        maxHp: 100,
        energy: ENERGY_MAX,
        weapon: WEAPONS[0],
        fireCooldown: 0,
        isPlayer: true,
        alive: true
    };
}

function createBot() {
    const angle = Math.random() * Math.PI * 2;
    const dist = 350 + Math.random() * 200;
    return {
        x: W / 2 + Math.cos(angle) * dist,
        y: H / 2 + Math.sin(angle) * dist,
        r: 12,
        hp: 80,
        maxHp: 80,
        energy: ENERGY_MAX,
        weapon: WEAPONS[Math.floor(Math.random() * WEAPONS.length)],
        fireCooldown: 0,
        isPlayer: false,
        alive: true,
        aiTimer: 0,
        vx: 0,
        vy: 0
    };
}

function createWall(x, y, w, h, hp = 120) {
    return { x, y, w, h, hp, maxHp: hp };
}

function createRandomBuilding() {
    const bw = 40 + Math.random() * 80;
    const bh = 40 + Math.random() * 80;
    const x = 60 + Math.random() * (W - 120 - bw);
    const y = 60 + Math.random() * (H - 120 - bh);
    return createWall(x, y, bw, bh, 150 + Math.random() * 100);
}

function createLoot() {
    const x = 40 + Math.random() * (W - 80);
    const y = 40 + Math.random() * (H - 80);
    const weapon = WEAPONS[Math.floor(Math.random() * WEAPONS.length)];
    return { x, y, r: 10, weapon };
}

function createBullet(owner, x, y, angle, weapon) {
    const bullets = [];
    const pellets = weapon.pellets || 1;
    for (let i = 0; i < pellets; i++) {
        const spreadAngle = angle + (Math.random() - 0.5) * (weapon.spread || 0);
        bullets.push({
            x,
            y,
            vx: Math.cos(spreadAngle) * weapon.bulletSpeed,
            vy: Math.sin(spreadAngle) * weapon.bulletSpeed,
            damage: weapon.damage,
            owner,
            life: 2,
            grenade: !!weapon.grenade,
            radius: weapon.radius || 0,
            exploded: false
        });
    }
    return bullets;
}

// ---------- STATE ----------

let player = createPlayer();
let bots = [];
let walls = [];
let loot = [];
let bullets = [];

let editMode = false;

let stormTime = 0;
let lastTime = performance.now() / 1000;

// ---------- INIT ----------

for (let i = 0; i < BOT_COUNT; i++) bots.push(createBot());
for (let i = 0; i < BUILDING_COUNT; i++) walls.push(createRandomBuilding());
for (let i = 0; i < LOOT_COUNT; i++) loot.push(createLoot());

// ---------- UTILS ----------

function clamp(v, min, max) {
    return v < min ? min : v > max ? max : v;
}

function dist2(a, b) {
    const dx = a.x - b.x;
    const dy = a.y - b.y;
    return dx * dx + dy * dy;
}

function rectContainsPoint(rect, px, py) {
    return px >= rect.x && px <= rect.x + rect.w && py >= rect.y && py <= rect.y + rect.h;
}

// ---------- GAME LOOP ----------

function update(dt) {
    if (!player.alive) {
        // restart med R
        if (keys["r"]) {
            resetGame();
        }
        return;
    }

    stormTime += dt;

    handlePlayer(dt);
    handleBots(dt);
    handleBullets(dt);
    handleLoot(dt);
    handleStormDamage(dt);
    handleEditMode();

    updateUI();
}

function handlePlayer(dt) {
    let speed = PLAYER_SPEED;
    let sprinting = false;

    if (keys["shift"] && player.energy > 0) {
        sprinting = true;
        speed *= SPRINT_MULT;
        player.energy -= ENERGY_DRAIN * dt;
    } else {
        player.energy += ENERGY_REGEN * dt;
    }

    player.energy = clamp(player.energy, 0, ENERGY_MAX);

    let vx = 0, vy = 0;
    if (keys["w"]) vy -= 1;
    if (keys["s"]) vy += 1;
    if (keys["a"]) vx -= 1;
    if (keys["d"]) vx += 1;

    const len = Math.hypot(vx, vy) || 1;
    vx /= len;
    vy /= len;

    player.x += vx * speed;
    player.y += vy * speed;

    player.x = clamp(player.x, 20, W - 20);
    player.y = clamp(player.y, 20, H - 20);

    // Kollisjon mot vegger
    for (const w of walls) {
        if (circleRectCollision(player, w)) {
            resolveCircleRect(player, w);
        }
    }

    // Skyting
    player.fireCooldown -= dt;
    if (mouse.down && player.fireCooldown <= 0) {
        shoot(player, player.weapon, mouse.x, mouse.y);
    }

    // Bytte våpen med talltaster
    for (let i = 0; i < WEAPONS.length; i++) {
        if (keys[(i + 1).toString()]) {
            player.weapon = WEAPONS[i];
        }
    }

    // Toggle edit mode
    if (keys["e"] && !editModeToggleLock) {
        editMode = !editMode;
        editModeToggleLock = true;
        setTimeout(() => editModeToggleLock = false, 200);
    }
}

let editModeToggleLock = false;

function handleBots(dt) {
    for (const bot of bots) {
        if (!bot.alive) continue;

        bot.aiTimer -= dt;
        if (bot.aiTimer <= 0) {
            bot.aiTimer = 0.6 + Math.random() * 0.6;
            const angle = Math.atan2(player.y - bot.y, player.x - bot.x);
            const speed = 1.4;
            bot.vx = Math.cos(angle) * speed;
            bot.vy = Math.sin(angle) * speed;
        }

        bot.x += bot.vx;
        bot.y += bot.vy;

        // Kollisjon mot vegger
        for (const w of walls) {
            if (circleRectCollision(bot, w)) {
                resolveCircleRect(bot, w);
            }
        }

        // Skyte mot spiller
        bot.fireCooldown -= dt;
        if (bot.fireCooldown <= 0 && player.alive) {
            const angle = Math.atan2(player.y - bot.y, player.x - bot.x);
            shoot(bot, bot.weapon, bot.x + Math.cos(angle) * bot.r, bot.y + Math.sin(angle) * bot.r, angle);
        }
    }
}

function shoot(shooter, weapon, tx, ty, forcedAngle) {
    const angle = forcedAngle !== undefined
        ? forcedAngle
        : Math.atan2(ty - shooter.y, tx - shooter.x);

    const originX = shooter.x + Math.cos(angle) * shooter.r;
    const originY = shooter.y + Math.sin(angle) * shooter.r;

    const newBullets = createBullet(shooter, originX, originY, angle, weapon);
    bullets.push(...newBullets);

    shooter.fireCooldown = weapon.fireRate;
}

function handleBullets(dt) {
    for (const b of bullets) {
        if (b.exploded) continue;

        b.x += b.vx;
        b.y += b.vy;
        b.life -= dt;

        if (b.life <= 0) {
            if (b.grenade && !b.exploded) {
                explodeGrenade(b);
            }
            b.exploded = true;
            continue;
        }

        // Kollisjon med vegger
        for (const w of walls) {
            if (b.x >= w.x && b.x <= w.x + w.w && b.y >= w.y && b.y <= w.y + w.h) {
                if (b.grenade) {
                    explodeGrenade(b);
                } else {
                    w.hp -= b.damage;
                }
                b.exploded = true;
                break;
            }
        }

        // Kollisjon med spiller/bots
        if (!b.exploded) {
            const targets = [player, ...bots];
            for (const t of targets) {
                if (!t.alive) continue;
                if (t === b.owner) continue;
                const d2 = (t.x - b.x) ** 2 + (t.y - b.y) ** 2;
                if (d2 <= t.r * t.r) {
                    if (b.grenade) {
                        explodeGrenade(b);
                    } else {
                        t.hp -= b.damage;
                        if (t.hp <= 0) t.alive = false;
                    }
                    b.exploded = true;
                    break;
                }
            }
        }
    }

    // Fjern døde kuler
    bullets = bullets.filter(b => !b.exploded && b.life > 0);
    // Fjern ødelagte vegger
    walls = walls.filter(w => w.hp > 0);
}

function explodeGrenade(b) {
    const radius2 = b.radius * b.radius;
    const targets = [player, ...bots];
    for (const t of targets) {
        if (!t.alive) continue;
        const d2 = dist2(b, t);
        if (d2 <= radius2) {
            t.hp -= b.damage;
            if (t.hp <= 0) t.alive = false;
        }
    }
    for (const w of walls) {
        const cx = w.x + w.w / 2;
        const cy = w.y + w.h / 2;
        const d2 = (cx - b.x) ** 2 + (cy - b.y) ** 2;
        if (d2 <= radius2) {
            w.hp -= b.damage;
        }
    }
}

function handleLoot(dt) {
    // Plukk opp loot
    loot = loot.filter(l => {
        const d2 = (l.x - player.x) ** 2 + (l.y - player.y) ** 2;
        if (d2 <= (player.r + l.r) ** 2) {
            player.weapon = l.weapon;
            return false;
        }
        return true;
    });

    // Respawn loot hvis lite
    if (loot.length < LOOT_COUNT) {
        loot.push(createLoot());
    }
}

function handleStormDamage(dt) {
    const t = clamp(stormTime / STORM_DURATION, 0, 1);
    const radius = STORM_START_RADIUS + (STORM_END_RADIUS - STORM_START_RADIUS) * t;

    const center = { x: W / 2, y: H / 2 };

    function applyStormDamage(entity) {
        if (!entity.alive) return;
        const d = Math.sqrt(dist2(entity, center));
        if (d > radius) {
            entity.hp -= STORM_DPS * dt;
            if (entity.hp <= 0) entity.alive = false;
        }
    }

    applyStormDamage(player);
    for (const bot of bots) applyStormDamage(bot);
}

function handleEditMode() {
    if (!editMode) return;
    if (!mouse.down) return;

    // Finn første vegg under mus
    for (const w of walls) {
        if (rectContainsPoint(w, mouse.x, mouse.y)) {
            w.hp = 0;
            break;
        }
    }
}

function circleRectCollision(c, r) {
    const closestX = clamp(c.x, r.x, r.x + r.w);
    const closestY = clamp(c.y, r.y, r.y + r.h);
    const dx = c.x - closestX;
    const dy = c.y - closestY;
    return dx * dx + dy * dy < c.r * c.r;
}

function resolveCircleRect(c, r) {
    const closestX = clamp(c.x, r.x, r.x + r.w);
    const closestY = clamp(c.y, r.y, r.y + r.h);
    const dx = c.x - closestX;
    const dy = c.y - closestY;
    const dist = Math.hypot(dx, dy) || 1;
    const overlap = c.r - dist;
    if (overlap > 0) {
        c.x += (dx / dist) * overlap;
        c.y += (dy / dist) * overlap;
    }
}

// ---------- RENDER ----------

function render() {
    ctx.clearRect(0, 0, W, H);

    // Bakgrunn
    ctx.fillStyle = "#151515";
    ctx.fillRect(0, 0, W, H);

    // Storm
    const t = clamp(stormTime / STORM_DURATION, 0, 1);
    const radius = STORM_START_RADIUS + (STORM_END_RADIUS - STORM_START_RADIUS) * t;
    ctx.save();
    ctx.strokeStyle = "rgba(120,180,255,0.8)";
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.arc(W / 2, H / 2, radius, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();

    // Vegger
    for (const w of walls) {
        const hpRatio = w.hp / w.maxHp;
        ctx.fillStyle = `rgba(${80 + 80 * (1 - hpRatio)}, ${80 + 40 * hpRatio}, 120, 1)`;
        ctx.fillRect(w.x, w.y, w.w, w.h);
    }

    // Loot
    for (const l of loot) {
        ctx.beginPath();
        ctx.fillStyle = "#ffd54f";
        ctx.arc(l.x, l.y, l.r, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = "#000";
        ctx.font = "10px sans-serif";
        ctx.textAlign = "center";
        ctx.fillText(l.weapon.name[0], l.x, l.y + 3);
    }

    // Kuler
    for (const b of bullets) {
        ctx.beginPath();
        ctx.fillStyle = b.grenade ? "#ff7043" : "#ffffff";
        ctx.arc(b.x, b.y, b.grenade ? 5 : 2, 0, Math.PI * 2);
        ctx.fill();
    }

    // Bots
    for (const bot of bots) {
        if (!bot.alive) continue;
        ctx.beginPath();
        ctx.fillStyle = "#ef5350";
        ctx.arc(bot.x, bot.y, bot.r, 0, Math.PI * 2);
        ctx.fill();

        // HP bar
        const w = 24;
        const h = 3;
        const ratio = bot.hp / bot.maxHp;
        ctx.fillStyle = "#000";
        ctx.fillRect(bot.x - w / 2, bot.y - bot.r - 8, w, h);
        ctx.fillStyle = "#e53935";
        ctx.fillRect(bot.x - w / 2, bot.y - bot.r - 8, w * ratio, h);
    }

    // Spiller
    if (player.alive) {
        ctx.beginPath();
        ctx.fillStyle = editMode ? "#81c784" : "#42a5f5";
        ctx.arc(player.x, player.y, player.r, 0, Math.PI * 2);
        ctx.fill();
    } else {
        ctx.fillStyle = "#fff";
        ctx.font = "32px sans-serif";
        ctx.textAlign = "center";
        ctx.fillText("DU DØDE - Trykk R for å restarte", W / 2, H / 2);
    }
}

function updateUI() {
    const hpBar = document.getElementById("hpBar");
    const energyBar = document.getElementById("energyBar");
    const weaponInfo = document.getElementById("weaponInfo");
    const stormInfo = document.getElementById("stormInfo");

    const hpRatio = clamp(player.hp / player.maxHp, 0, 1);
    const energyRatio = clamp(player.energy / ENERGY_MAX, 0, 1);

    hpBar.style.setProperty("--hp", hpRatio);
    energyBar.style.setProperty("--energy", energyRatio);

    hpBar.style.setProperty("background-image",
        `linear-gradient(to right, #e53935 ${hpRatio * 100}%, #333 ${hpRatio * 100}%)`);
    energyBar.style.setProperty("background-image",
        `linear-gradient(to right, #42a5f5 ${energyRatio * 100}%, #333 ${energyRatio * 100}%)`);

    weaponInfo.textContent = `Våpen: ${player.weapon.name} | DMG: ${player.weapon.damage}`;
    const t = clamp(stormTime / STORM_DURATION, 0, 1);
    const radius = Math.floor(STORM_START_RADIUS + (STORM_END_RADIUS - STORM_START_RADIUS) * t);
    stormInfo.textContent = `Storm radius: ${radius}`;
}

function resetGame() {
    player = createPlayer();
    bots = [];
    walls = [];
    loot = [];
    bullets = [];
    stormTime = 0;

    for (let i = 0; i < BOT_COUNT; i++) bots.push(createBot());
    for (let i = 0; i < BUILDING_COUNT; i++) walls.push(createRandomBuilding());
    for (let i = 0; i < LOOT_COUNT; i++) loot.push(createLoot());
}

// ---------- MAIN LOOP ----------

function loop() {
    const now = performance.now() / 1000;
    const dt = now - lastTime;
    lastTime = now;

    update(dt);
    render();

    requestAnimationFrame(loop);
}

loop();
