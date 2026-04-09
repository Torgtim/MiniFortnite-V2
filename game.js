const canvas = document.getElementById("gameCanvas");
const ctx = canvas.getContext("2d");

function resizeCanvas() {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
}
window.addEventListener("resize", resizeCanvas);
resizeCanvas();

const W = () => canvas.width;
const H = () => canvas.height;

// UI elements
const hpBar = document.getElementById("hpBar");
const energyBar = document.getElementById("energyBar");
const weaponInfo = document.getElementById("weaponInfo");
const stormInfo = document.getElementById("stormInfo");
const modeInfo = document.getElementById("modeInfo");
const inventorySlots = Array.from(document.querySelectorAll(".slot"));

const btnUse = document.getElementById("btnUse");
const btnBuild = document.getElementById("btnBuild");
const btnEdit = document.getElementById("btnEdit");
const btnSprint = document.getElementById("btnSprint");

const leftStick = document.getElementById("leftStick");
const rightStick = document.getElementById("rightStick");
const leftThumb = document.getElementById("leftThumb");
const rightThumb = document.getElementById("rightThumb");

// Game constants
const PLAYER_BASE_SPEED = 2.2;
const SPRINT_MULT = 1.7;
const ENERGY_MAX = 100;
const ENERGY_DRAIN = 25;
const ENERGY_REGEN = 15;

const BOT_COUNT = 6;
const BUILDING_COUNT = 18;
const LOOT_COUNT = 14;

const STORM_START_RADIUS = 900;
const STORM_END_RADIUS = 120;
const STORM_DURATION = 180;
const STORM_DPS = 5;

const PICKAXE = { type: "pickaxe", name: "Pickaxe", damage: 10 };
const WEAPONS = [
    { type: "weapon", name: "Pistol", damage: 15, fireRate: 0.35, bulletSpeed: 7, spread: 0.05 },
    { type: "weapon", name: "Shotgun", damage: 10, fireRate: 0.8, bulletSpeed: 6, pellets: 6, spread: 0.4 },
    { type: "weapon", name: "Sniper", damage: 60, fireRate: 1.2, bulletSpeed: 10, spread: 0.01 },
    { type: "weapon", name: "SMG", damage: 8, fireRate: 0.12, bulletSpeed: 7, spread: 0.12 },
    { type: "item", name: "Shield", shield: 30 },
    { type: "weapon", name: "Grenade", damage: 40, fireRate: 1.5, grenade: true, radius: 70 }
];

function randomWeapon() {
    return { ...WEAPONS[Math.floor(Math.random() * WEAPONS.length)] };
}

// State
let player;
let bots = [];
let walls = [];
let loot = [];
let bullets = [];

let stormTime = 0;
let lastTime = performance.now() / 1000;

let buildMode = false;
let editMode = false;

let leftStickTouch = null;
let rightStickTouch = null;
let moveVector = { x: 0, y: 0 };
let aimVector = { x: 1, y: 0 };
let sprintHeld = false;
let useHeld = false;

let inventory = [null, null, null, null, null];
let selectedSlot = 0;
let slotHoldTimers = [0, 0, 0, 0, 0];
let slotHoldActive = [false, false, false, false, false];

function createPlayer() {
    return {
        x: W() / 2,
        y: H() / 2,
        r: 16,
        hp: 100,
        maxHp: 100,
        shield: 0,
        energy: ENERGY_MAX,
        fireCooldown: 0,
        alive: true
    };
}

function createBot() {
    const angle = Math.random() * Math.PI * 2;
    const dist = 350 + Math.random() * 250;
    return {
        x: W() / 2 + Math.cos(angle) * dist,
        y: H() / 2 + Math.sin(angle) * dist,
        r: 14,
        hp: 80,
        maxHp: 80,
        fireCooldown: 0,
        weapon: randomWeapon(),
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
    const margin = 80;
    const x = margin + Math.random() * (W() - 2 * margin - bw);
    const y = margin + Math.random() * (H() - 2 * margin - bh);
    return createWall(x, y, bw, bh, 150 + Math.random() * 100);
}

function createLoot() {
    const margin = 60;
    const x = margin + Math.random() * (W() - 2 * margin);
    const y = margin + Math.random() * (H() - 2 * margin);
    const item = randomWeapon();
    return { x, y, r: 12, item };
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

// Inventory helpers
function setInventorySlot(i, item) {
    inventory[i] = item;
    const slot = inventorySlots[i];
    slot.innerHTML = "";
    if (item) {
        const span = document.createElement("span");
        span.textContent = item.name;
        slot.appendChild(span);
    }
}

function initInventory() {
    setInventorySlot(0, { ...PICKAXE });
    for (let i = 1; i < 5; i++) setInventorySlot(i, null);
    selectSlot(0);
}

function selectSlot(i) {
    selectedSlot = i;
    inventorySlots.forEach((s, idx) => {
        s.classList.toggle("selected", idx === i);
    });
}

function getSelectedItem() {
    return inventory[selectedSlot];
}

function addItemToInventory(item) {
    for (let i = 1; i < 5; i++) {
        if (!inventory[i]) {
            setInventorySlot(i, item);
            return true;
        }
    }
    return false;
}

function dropItemFromSlot(i) {
    const item = inventory[i];
    if (!item || i === 0) return;
    loot.push({ x: player.x, y: player.y, r: 12, item });
    setInventorySlot(i, null);
    if (selectedSlot === i) selectSlot(0);
}

// Init game
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

    // sørg for at player ikke spawner rett ved masse bots
    for (const bot of bots) {
        const d2 = dist2(player, bot);
        const minDist = 250;
        if (d2 < minDist * minDist) {
            const angle = Math.atan2(bot.y - player.y, bot.x - player.x);
            bot.x = player.x + Math.cos(angle) * (minDist + 50);
            bot.y = player.y + Math.sin(angle) * (minDist + 50);
        }
    }

    initInventory();
    buildMode = false;
    editMode = false;
}
resetGame();

// Touch / controls
function getCenter(el) {
    const rect = el.getBoundingClientRect();
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2, r: rect.width / 2 };
}

function handleStickTouchStart(e) {
    for (const touch of e.changedTouches) {
        const x = touch.clientX;
        const y = touch.clientY;
        const leftRect = leftStick.getBoundingClientRect();
        const rightRect = rightStick.getBoundingClientRect();

        if (!leftStickTouch && x >= leftRect.left && x <= leftRect.right && y >= leftRect.top && y <= leftRect.bottom) {
            leftStickTouch = touch.identifier;
        } else if (!rightStickTouch && x >= rightRect.left && x <= rightRect.right && y >= rightRect.top && y <= rightRect.bottom) {
            rightStickTouch = touch.identifier;
        }
    }
}

function handleStickTouchMove(e) {
    const leftCenter = getCenter(leftStick);
    const rightCenter = getCenter(rightStick);

    for (const touch of e.changedTouches) {
        if (touch.identifier === leftStickTouch) {
            const dx = touch.clientX - leftCenter.x;
            const dy = touch.clientY - leftCenter.y;
            const dist = Math.hypot(dx, dy);
            const maxDist = leftCenter.r;
            const nx = dist > 0 ? dx / dist : 0;
            const ny = dist > 0 ? dy / dist : 0;
            const clampedDist = Math.min(dist, maxDist);
            moveVector.x = nx;
            moveVector.y = ny;
            leftThumb.style.transform = `translate(${nx * (maxDist - 30)}px, ${ny * (maxDist - 30)}px)`;
        }
        if (touch.identifier === rightStickTouch) {
            const dx = touch.clientX - rightCenter.x;
            const dy = touch.clientY - rightCenter.y;
            const dist = Math.hypot(dx, dy);
            const maxDist = rightCenter.r;
            const nx = dist > 0 ? dx / dist : 0;
            const ny = dist > 0 ? dy / dist : 0;
            const clampedDist = Math.min(dist, maxDist);
            aimVector.x = nx || aimVector.x;
            aimVector.y = ny || aimVector.y;
            rightThumb.style.transform = `translate(${nx * (maxDist - 30)}px, ${ny * (maxDist - 30)}px)`;
        }
    }
}

function handleStickTouchEnd(e) {
    for (const touch of e.changedTouches) {
        if (touch.identifier === leftStickTouch) {
            leftStickTouch = null;
            moveVector.x = 0;
            moveVector.y = 0;
            leftThumb.style.transform = "translate(-50%, -50%)";
        }
        if (touch.identifier === rightStickTouch) {
            rightStickTouch = null;
            rightThumb.style.transform = "translate(-50%, -50%)";
        }
    }
}

leftStick.addEventListener("touchstart", handleStickTouchStart);
leftStick.addEventListener("touchmove", handleStickTouchMove);
leftStick.addEventListener("touchend", handleStickTouchEnd);
leftStick.addEventListener("touchcancel", handleStickTouchEnd);

rightStick.addEventListener("touchstart", handleStickTouchStart);
rightStick.addEventListener("touchmove", handleStickTouchMove);
rightStick.addEventListener("touchend", handleStickTouchEnd);
rightStick.addEventListener("touchcancel", handleStickTouchEnd);

// Buttons
btnSprint.addEventListener("touchstart", () => { sprintHeld = true; });
btnSprint.addEventListener("touchend", () => { sprintHeld = false; });
btnSprint.addEventListener("touchcancel", () => { sprintHeld = false; });

btnUse.addEventListener("touchstart", () => { useHeld = true; });
btnUse.addEventListener("touchend", () => { useHeld = false; });
btnUse.addEventListener("touchcancel", () => { useHeld = false; });

btnBuild.addEventListener("touchstart", () => {
    buildMode = !buildMode;
    if (buildMode) editMode = false;
});

btnEdit.addEventListener("touchstart", () => {
    editMode = !editMode;
    if (editMode) buildMode = false;
});

// Inventory touch (tap = select, hold = drop)
inventorySlots.forEach((slotEl, idx) => {
    slotEl.addEventListener("touchstart", () => {
        slotHoldActive[idx] = true;
        slotHoldTimers[idx] = 0;
    });
    slotEl.addEventListener("touchend", () => {
        if (slotHoldTimers[idx] < 0.5) {
            selectSlot(idx);
        } else {
            dropItemFromSlot(idx);
        }
        slotHoldActive[idx] = false;
        slotHoldTimers[idx] = 0;
    });
    slotEl.addEventListener("touchcancel", () => {
        slotHoldActive[idx] = false;
        slotHoldTimers[idx] = 0;
    });
});

// Edit mode: tap vegg for å fjerne
canvas.addEventListener("touchstart", e => {
    if (!editMode) return;
    const touch = e.changedTouches[0];
    const rect = canvas.getBoundingClientRect();
    const x = touch.clientX - rect.left;
    const y = touch.clientY - rect.top;
    for (const w of walls) {
        if (rectContainsPoint(w, x, y)) {
            w.hp = 0;
            break;
        }
    }
});

// Game logic
function update(dt) {
    if (!player.alive) return;

    stormTime += dt;

    // slot hold timers
    for (let i = 0; i < 5; i++) {
        if (slotHoldActive[i]) {
            slotHoldTimers[i] += dt;
        }
    }

    handlePlayer(dt);
    handleBots(dt);
    handleBullets(dt);
    handleLoot(dt);
    handleStormDamage(dt);

    walls = walls.filter(w => w.hp > 0);
    bullets = bullets.filter(b => !b.exploded && b.life > 0);
}

function handlePlayer(dt) {
    let speed = PLAYER_BASE_SPEED;
    if (sprintHeld && player.energy > 0) {
        speed *= SPRINT_MULT;
        player.energy -= ENERGY_DRAIN * dt;
    } else {
        player.energy += ENERGY_REGEN * dt;
    }
    player.energy = clamp(player.energy, 0, ENERGY_MAX);

    const len = Math.hypot(moveVector.x, moveVector.y) || 1;
    const vx = (moveVector.x / len) * speed;
    const vy = (moveVector.y / len) * speed;

    player.x += vx;
    player.y += vy;

    player.x = clamp(player.x, 20, W() - 20);
    player.y = clamp(player.y, 20, H() - 20);

    for (const w of walls) {
        if (circleRectCollision(player, w)) {
            resolveCircleRect(player, w);
        }
    }

    player.fireCooldown -= dt;

    if (useHeld) {
        handleUseAction(dt);
    }
}

function handleUseAction(dt) {
    const item = getSelectedItem();
    if (!item) return;

    if (buildMode) {
        // bygg vegg foran spilleren
        const angle = Math.atan2(aimVector.y, aimVector.x);
        const dist = 60;
        const w = 50;
        const h = 20;
        const x = player.x + Math.cos(angle) * dist - w / 2;
        const y = player.y + Math.sin(angle) * dist - h / 2;
        walls.push(createWall(x, y, w, h, 120));
        buildMode = false;
        return;
    }

    if (item.type === "weapon") {
        if (player.fireCooldown <= 0) {
            const angle = Math.atan2(aimVector.y, aimVector.x);
            const originX = player.x + Math.cos(angle) * player.r;
            const originY = player.y + Math.sin(angle) * player.r;
            const newBullets = createBullet(player, originX, originY, angle, item);
            bullets.push(...newBullets);
            player.fireCooldown = item.fireRate;
        }
    } else if (item.type === "item" && item.shield) {
        const missingShield = 100 - player.shield;
        if (missingShield > 0) {
            player.shield = clamp(player.shield + item.shield, 0, 100);
            // bruk opp shield item
            const idx = selectedSlot;
            setInventorySlot(idx, null);
            selectSlot(0);
        }
    } else if (item.type === "pickaxe") {
        // pickaxe: nærmeste vegg foran spilleren
        const angle = Math.atan2(aimVector.y, aimVector.x);
        const reach = 60;
        const px = player.x + Math.cos(angle) * reach;
        const py = player.y + Math.sin(angle) * reach;
        let best = null;
        let bestD2 = Infinity;
        for (const w of walls) {
            if (rectContainsPoint(w, px, py)) {
                const cx = w.x + w.w / 2;
                const cy = w.y + w.h / 2;
                const d2 = (cx - player.x) ** 2 + (cy - player.y) ** 2;
                if (d2 < bestD2) {
                    bestD2 = d2;
                    best = w;
                }
            }
        }
        if (best) {
            best.hp -= PICKAXE.damage;
        }
    }
}

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

        for (const w of walls) {
            if (circleRectCollision(bot, w)) {
                resolveCircleRect(bot, w);
            }
        }

        bot.fireCooldown -= dt;
        if (bot.fireCooldown <= 0 && player.alive) {
            const angle = Math.atan2(player.y - bot.y, player.x - bot.x);
            const originX = bot.x + Math.cos(angle) * bot.r;
            const originY = bot.y + Math.sin(angle) * bot.r;
            const newBullets = createBullet(bot, originX, originY, angle, bot.weapon);
            bullets.push(...newBullets);
            bot.fireCooldown = bot.weapon.fireRate;
        }
    }
}

function explodeGrenade(b) {
    const radius2 = b.radius * b.radius;
    const targets = [player, ...bots];
    for (const t of targets) {
        if (!t.alive) continue;
        const d2 = dist2(b, t);
        if (d2 <= radius2) {
            applyDamage(t, b.damage);
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

function applyDamage(entity, dmg) {
    if (entity === player) {
        let remaining = dmg;
        if (player.shield > 0) {
            const used = Math.min(player.shield, remaining);
            player.shield -= used;
            remaining -= used;
        }
        if (remaining > 0) {
            player.hp -= remaining;
        }
        if (player.hp <= 0) player.alive = false;
    } else {
        entity.hp -= dmg;
        if (entity.hp <= 0) entity.alive = false;
    }
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
                        applyDamage(t, b.damage);
                    }
                    b.exploded = true;
                    break;
                }
            }
        }
    }
}

function handleLoot(dt) {
    // pickup
    loot = loot.filter(l => {
        const d2 = (l.x - player.x) ** 2 + (l.y - player.y) ** 2;
        if (d2 <= (player.r + l.r) ** 2) {
            addItemToInventory({ ...l.item });
            return false;
        }
        return true;
    });

    if (loot.length < LOOT_COUNT) {
        loot.push(createLoot());
    }
}

function handleStormDamage(dt) {
    const t = clamp(stormTime / STORM_DURATION, 0, 1);
    const radius = STORM_START_RADIUS + (STORM_END_RADIUS - STORM_START_RADIUS) * t;
    const center = { x: W() / 2, y: H() / 2 };

    function applyStorm(entity) {
        if (!entity.alive) return;
        const d = Math.sqrt(dist2(entity, center));
        if (d > radius) {
            applyDamage(entity, STORM_DPS * dt);
        }
    }

    applyStorm(player);
    for (const bot of bots) applyStorm(bot);
}

// Render
function render() {
    ctx.clearRect(0, 0, W(), H());

    ctx.fillStyle = "#151515";
    ctx.fillRect(0, 0, W(), H());

    const t = clamp(stormTime / STORM_DURATION, 0, 1);
    const radius = STORM_START_RADIUS + (STORM_END_RADIUS - STORM_START_RADIUS) * t;
    ctx.save();
    ctx.strokeStyle = "rgba(120,180,255,0.8)";
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.arc(W() / 2, H() / 2, radius, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();

    for (const w of walls) {
        const hpRatio = w.hp / w.maxHp;
        ctx.fillStyle = `rgba(${80 + 80 * (1 - hpRatio)}, ${80 + 40 * hpRatio}, 120, 1)`;
        ctx.fillRect(w.x, w.y, w.w, w.h);
    }

    for (const l of loot) {
        ctx.beginPath();
        ctx.fillStyle = "#ffd54f";
        ctx.arc(l.x, l.y, l.r, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = "#000";
        ctx.font = "10px sans-serif";
        ctx.textAlign = "center";
        ctx.fillText(l.item.name[0], l.x, l.y + 3);
    }

    for (const b of bullets) {
        ctx.beginPath();
        ctx.fillStyle = b.grenade ? "#ff7043" : "#ffffff";
        ctx.arc(b.x, b.y, b.grenade ? 5 : 2, 0, Math.PI * 2);
        ctx.fill();
    }

    for (const bot of bots) {
        if (!bot.alive) continue;
        ctx.beginPath();
        ctx.fillStyle = "#ef5350";
        ctx.arc(bot.x, bot.y, bot.r, 0, Math.PI * 2);
        ctx.fill();

        const w = 24;
        const h = 3;
        const ratio = bot.hp / bot.maxHp;
        ctx.fillStyle = "#000";
        ctx.fillRect(bot.x - w / 2, bot.y - bot.r - 8, w, h);
        ctx.fillStyle = "#e53935";
        ctx.fillRect(bot.x - w / 2, bot.y - bot.r - 8, w * ratio, h);
    }

    if (player.alive) {
        ctx.beginPath();
        ctx.fillStyle = editMode ? "#81c784" : buildMode ? "#ffb74d" : "#42a5f5";
        ctx.arc(player.x, player.y, player.r, 0, Math.PI * 2);
        ctx.fill();
    } else {
        ctx.fillStyle = "#fff";
        ctx.font = "24px sans-serif";
        ctx.textAlign = "center";
        ctx.fillText("DU DØDE – reload siden for restart", W() / 2, H() / 2);
    }

    updateUI();
}

function updateUI() {
    const hpRatio = clamp(player.hp / player.maxHp, 0, 1);
    const energyRatio = clamp(player.energy / ENERGY_MAX, 0, 1);

    hpBar.style.setProperty("background-image",
        `linear-gradient(to right, #e53935 ${hpRatio * 100}%, #333 ${hpRatio * 100}%)`);
    energyBar.style.setProperty("background-image",
        `linear-gradient(to right, #42a5f5 ${energyRatio * 100}%, #333 ${energyRatio * 100}%)`);

    const item = getSelectedItem();
    const name = item ? item.name : "Ingen";
    weaponInfo.textContent = `Selected: ${name}`;
    const t = clamp(stormTime / STORM_DURATION, 0, 1);
    const radius = Math.floor(STORM_START_RADIUS + (STORM_END_RADIUS - STORM_START_RADIUS) * t);
    stormInfo.textContent = `Storm radius: ${radius}`;
    modeInfo.textContent = `Mode: ${buildMode ? "BUILD" : editMode ? "EDIT" : "COMBAT"} | Shield: ${Math.floor(player.shield)}`;
}

// Main loop
function loop() {
    const now = performance.now() / 1000;
    const dt = now - lastTime;
    lastTime = now;

    update(dt);
    render();

    requestAnimationFrame(loop);
}
loop();
