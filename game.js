// ============================================================
//  GABRIEL CONTRA OS MONSTROS
//  Jogo 2D de plataforma e sobrevivência
//  Criado por Gabriel, com ajuda de IA :)
// ============================================================

const canvas = document.getElementById('gameCanvas');
const ctx    = canvas.getContext('2d');
const W = canvas.width;   // 800
const H = canvas.height;  // 500

// ── Constantes de física ──────────────────────────────────────
const GRAVITY     = 0.55;
const JUMP_POWER  = -13;

// ── Estado global ─────────────────────────────────────────────
let gameState    = 'menu';   // 'menu' | 'playing' | 'gameOver' | 'victory'
let currentPhase = 0;        // 0–4  (fases 1–5)
let score        = 0;
let cameraX      = 0;

// ── Objetos ativos ────────────────────────────────────────────
let player;
let enemies    = [];
let bosses     = [];
let projs      = [];   // projéteis
let items      = [];
let particles  = [];
let platforms  = [];
let levelWidth = 4000;

// ── Flags de progresso da fase ────────────────────────────────
let midBossSpawned  = false;
let midBossDefeated = false;
let extraBossSpawned = false;  // Fase 5: Rei dos Zumbis
let finalBossSpawned = false;
let phaseData = null;

// ── Mensagem de poder desbloqueado ───────────────────────────
let powerMsg      = '';
let powerMsgTimer = 0;

// ── Input ─────────────────────────────────────────────────────
const keys = {};
let jumpPressed = false;   // evita pular infinitamente

document.addEventListener('keydown', e => {
  if (!keys[e.key]) {
    if (e.key === 'w' || e.key === 'ArrowUp' || e.key === ' ') jumpPressed = true;
  }
  keys[e.key] = true;
  // Impede a página de rolar com setas/espaço
  if ([' ', 'ArrowUp', 'ArrowDown'].includes(e.key)) e.preventDefault();
});
document.addEventListener('keyup', e => {
  keys[e.key] = false;
});

// ─────────────────────────────────────────────────────────────
//  ÁUDIO – sintetizador simples sem arquivos externos
// ─────────────────────────────────────────────────────────────
let audioCtx = null;

function getAudio() {
  if (!audioCtx) {
    try { audioCtx = new (window.AudioContext || window.webkitAudioContext)(); }
    catch (e) { return null; }
  }
  return audioCtx;
}

// Parâmetros de cada som
const SOUNDS = {
  jump:    { f1: 350, f2: 600, dur: 0.12, vol: 0.12, wave: 'square'   },
  shoot:   { f1: 700, f2: 300, dur: 0.07, vol: 0.08, wave: 'square'   },
  hurt:    { f1: 180, f2:  80, dur: 0.18, vol: 0.18, wave: 'sawtooth' },
  magic:   { f1: 500, f2: 900, dur: 0.22, vol: 0.12, wave: 'sine'     },
  special: { f1: 200, f2: 900, dur: 0.35, vol: 0.18, wave: 'sine'     },
  collect: { f1: 600, f2:1000, dur: 0.10, vol: 0.10, wave: 'sine'     },
  hit:     { f1: 250, f2: 150, dur: 0.09, vol: 0.12, wave: 'sawtooth' },
  victory: { f1: 400, f2: 900, dur: 0.60, vol: 0.18, wave: 'sine'     },
};

function playSound(name) {
  const ac = getAudio();
  if (!ac) return;
  const s = SOUNDS[name];
  if (!s) return;
  const osc  = ac.createOscillator();
  const gain = ac.createGain();
  osc.connect(gain);
  gain.connect(ac.destination);
  osc.type = s.wave;
  osc.frequency.setValueAtTime(s.f1, ac.currentTime);
  osc.frequency.linearRampToValueAtTime(s.f2, ac.currentTime + s.dur);
  gain.gain.setValueAtTime(s.vol, ac.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.001, ac.currentTime + s.dur);
  osc.start(ac.currentTime);
  osc.stop(ac.currentTime + s.dur + 0.01);
}

// ─────────────────────────────────────────────────────────────
//  UTILITÁRIOS
// ─────────────────────────────────────────────────────────────

// Testa se dois retângulos se sobrepõem
function overlaps(a, b) {
  return a.x < b.x + b.w && a.x + a.w > b.x &&
         a.y < b.y + b.h && a.y + a.h > b.y;
}

// Aplica colisão do personagem com plataformas
// Retorna true se está no chão
function applyPlatformCollision(obj, platforms) {
  let onGround = false;
  for (const p of platforms) {
    if (p.spike) continue;  // pulos em spike são tratados à parte
    // Verifica colisão horizontal
    const overlapX = obj.x < p.x + p.w && obj.x + obj.w > p.x;
    if (!overlapX) continue;
    // Aterrissar em cima da plataforma
    if (obj.vy >= 0 && obj.y + obj.h <= p.y + 12 && obj.y + obj.h + obj.vy >= p.y) {
      obj.y = p.y - obj.h;
      obj.vy = 0;
      onGround = true;
    }
  }
  return onGround;
}

// ─────────────────────────────────────────────────────────────
//  PARTÍCULAS
// ─────────────────────────────────────────────────────────────
class Particle {
  constructor(x, y, color, vx, vy) {
    this.x = x; this.y = y;
    this.vx = vx ?? (Math.random() - 0.5) * 7;
    this.vy = vy ?? (Math.random() - 0.5) * 7 - 2;
    this.color = color;
    this.maxLife = 25 + Math.random() * 20;
    this.life = this.maxLife;
    this.size = 3 + Math.random() * 5;
  }
  update() {
    this.x += this.vx;
    this.y += this.vy;
    this.vy += 0.3;
    this.vx *= 0.95;
    this.life--;
  }
  draw() {
    ctx.globalAlpha = this.life / this.maxLife;
    ctx.fillStyle = this.color;
    ctx.fillRect(this.x - cameraX - this.size / 2, this.y - this.size / 2, this.size, this.size);
    ctx.globalAlpha = 1;
  }
}

function burst(x, y, color, n = 8) {
  for (let i = 0; i < n; i++) particles.push(new Particle(x, y, color));
}

// ─────────────────────────────────────────────────────────────
//  PROJÉTIL
// ─────────────────────────────────────────────────────────────
class Projectile {
  constructor(x, y, vx, vy, owner, damage) {
    this.x = x; this.y = y;
    this.vx = vx; this.vy = vy;
    this.owner  = owner;   // 'player' | 'magic' | 'special' | 'enemy' | 'boss'
    this.damage = damage;
    this.w = owner === 'magic' ? 14 : owner === 'special' ? 12 : 9;
    this.h = this.w;
    this.ttl  = 140;
    this.dead = false;
  }
  update() {
    this.x += this.vx;
    this.y += this.vy;
    this.ttl--;
    if (this.ttl <= 0) this.dead = true;
    // Sai da tela lateral
    if (this.x < cameraX - 200 || this.x > cameraX + W + 200) this.dead = true;
  }
  draw() {
    const COLORS = {
      player:  '#FFD700',
      magic:   '#FF6B00',
      special: '#00FFFF',
      laser:   '#00e5ff',
      enemy:   '#e74c3c',
      boss:    '#9b59b6',
    };
    const col = COLORS[this.owner] || '#fff';
    ctx.fillStyle = col;
    ctx.shadowColor = col;
    ctx.shadowBlur = 10;
    ctx.fillRect(this.x - cameraX, this.y, this.w, this.h);
    ctx.shadowBlur = 0;
  }
}

// ─────────────────────────────────────────────────────────────
//  ITEM COLETÁVEL
// ─────────────────────────────────────────────────────────────
class Item {
  constructor(x, y, type) {
    this.x = x; this.y = y;
    this.type = type;
    this.w = 22; this.h = 22;
    this.vy = -3;
    this.onGround = false;
    this.collected = false;
    this.bobT = Math.random() * Math.PI * 2;
  }
  update() {
    if (!this.onGround) {
      this.vy += GRAVITY;
      this.y += this.vy;
      this.onGround = applyPlatformCollision(this, platforms);
    }
    this.bobT += 0.05;
  }
  draw() {
    const sx = this.x - cameraX;
    const sy = this.y + Math.sin(this.bobT) * 3;

    const COL = {
      heart:'#e74c3c', coin:'#f1c40f', crystal:'#9b59b6',
      key:'#f39c12',   shield:'#3498db',
      // Novas armas e poderes
      weapon2:'#e67e22',   // tiro duplo
      weaponLaser:'#00e5ff', // laser
      speedBoots:'#2ecc71',  // velocidade
      superJump:'#9b59b6',   // super pulo
      rage:'#e74c3c',        // dano dobrado temporário
    };
    const col = COL[this.type] || '#fff';

    ctx.fillStyle = col;
    ctx.shadowColor = col;
    ctx.shadowBlur = 8;

    if (this.type === 'heart') {
      ctx.fillRect(sx + 2, sy + 2, 8, 6);
      ctx.fillRect(sx + 12, sy + 2, 8, 6);
      ctx.fillRect(sx, sy + 6, 22, 8);
      ctx.fillRect(sx + 4, sy + 13, 14, 5);
      ctx.fillRect(sx + 8, sy + 17, 6, 4);
    } else if (this.type === 'coin') {
      ctx.beginPath();
      ctx.arc(sx + 11, sy + 11, 9, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#fff';
      ctx.font = 'bold 10px monospace';
      ctx.textAlign = 'center';
      ctx.fillText('$', sx + 11, sy + 15);
    } else {
      // Caixa brilhante para armas e poderes especiais
      const isSpecial = ['weapon2','weaponLaser','speedBoots','superJump','rage'].includes(this.type);
      if (isSpecial) {
        // Borda pulsante para itens especiais
        const pulse = Math.sin(this.bobT * 2) * 2;
        ctx.strokeStyle = col;
        ctx.lineWidth = 2 + pulse;
        ctx.strokeRect(sx - 2, sy - 2, this.w + 4, this.h + 4);
      }
      ctx.fillRect(sx, sy, this.w, this.h);
      ctx.fillStyle = '#fff';
      ctx.font = 'bold 11px monospace';
      ctx.textAlign = 'center';
      const icons = {
        crystal:'✦', key:'🔑', shield:'🛡',
        weapon2:'✦✦', weaponLaser:'⚡', speedBoots:'👟',
        superJump:'⬆', rage:'💢',
      };
      ctx.fillText(icons[this.type] || '?', sx + 11, sy + 15);
    }
    ctx.shadowBlur = 0;
    ctx.textAlign = 'left';
  }
}

// ─────────────────────────────────────────────────────────────
//  JOGADOR (Gabriel)
// ─────────────────────────────────────────────────────────────
class Player {
  constructor() { this.init(); }

  init() {
    this.x = 100; this.y = 300;
    this.w = 32;  this.h = 44;
    this.vx = 0;  this.vy = 0;
    this.onGround   = false;
    this.facing     = 1;       // 1=direita, -1=esquerda
    this.hp         = 150;
    this.maxHp      = 150;
    this.invincible = 0;       // frames de invencibilidade após levar dano

    // Poderes
    this.shootPower   = 1;      // 1 = básico, 2 = melhorado
    this.doubleJump   = false;
    this.canDJump     = false;
    this.hasFireMagic = false;
    this.hasShield    = false;
    this.shieldTimer  = 0;
    this.hasSpecial   = false;

    // Energia
    this.mana         = 0;
    this.maxMana      = 100;
    this.specialCharge= 0;

    // Modo de arma atual
    this.weaponMode  = 'basic';  // 'basic' | 'double' | 'laser'
    this.laserTimer  = 0;

    // Poderes temporários
    this.speedBoost     = 0;
    this.superJumpTimer = 0;
    this.rageTimer      = 0;

    // Cooldowns
    this.shootCD  = 0;
    this.magicCD  = 0;
    this.specialCD= 0;

    // Animação
    this.animT = 0;
    this.animF = 0;
  }

  update() {
    // ── Contagem regressiva dos poderes temporários ──────────
    if (this.laserTimer  > 0) { this.laserTimer--;  if (this.laserTimer  === 0) this.weaponMode = 'basic'; }
    if (this.speedBoost  > 0)   this.speedBoost--;
    if (this.superJumpTimer > 0) this.superJumpTimer--;
    if (this.rageTimer   > 0)   this.rageTimer--;

    // ── Movimento horizontal ──────────────────────────────
    const left  = keys['a'] || keys['ArrowLeft'];
    const right = keys['d'] || keys['ArrowRight'];
    const spd = this.speedBoost > 0 ? 8 : 5;
    if (left)       { this.vx = -spd; this.facing = -1; }
    else if (right) { this.vx =  spd; this.facing =  1; }
    else            { this.vx *= 0.75; }

    // ── Pulo ─────────────────────────────────────────────
    if (jumpPressed) {
      const jp = this.superJumpTimer > 0 ? JUMP_POWER * 1.5 : JUMP_POWER;
      if (this.onGround) {
        this.vy = jp;
        this.onGround = false;
        this.canDJump = true;
        playSound('jump');
      } else if (this.doubleJump && this.canDJump) {
        this.vy = jp * 0.85;
        this.canDJump = false;
        playSound('jump');
      }
    }

    // ── Tiro ─────────────────────────────────────────────
    if (keys['j'] && this.shootCD <= 0) {
      const spd  = 9 + this.shootPower * 2;
      const dmgBase = 10 + this.shootPower * 8;
      const dmg  = this.rageTimer > 0 ? dmgBase * 2 : dmgBase;
      const ox   = this.facing > 0 ? this.w : -8;
      const owner = this.weaponMode === 'laser' ? 'laser' : 'player';

      if (this.weaponMode === 'double') {
        // Dois tiros em paralelo
        projs.push(new Projectile(this.x + ox, this.y + this.h / 2 - 8, this.facing * spd, 0, 'player', dmg));
        projs.push(new Projectile(this.x + ox, this.y + this.h / 2 + 4, this.facing * spd, 0, 'player', dmg));
      } else if (this.weaponMode === 'laser') {
        // Laser: projétil mais rápido e maior
        projs.push(new Projectile(this.x + ox, this.y + this.h / 2 - 4, this.facing * 16, 0, 'laser', dmg * 1.5));
      } else {
        projs.push(new Projectile(this.x + ox, this.y + this.h / 2 - 4, this.facing * spd, 0, 'player', dmg));
      }
      this.shootCD = this.weaponMode === 'double' ? 12 : this.shootPower > 1 ? 10 : 14;
      playSound('shoot');
    }

    // ── Magia de fogo ────────────────────────────────────
    if (keys['k'] && this.hasFireMagic && this.magicCD <= 0 && this.mana >= 20) {
      const ox = this.facing > 0 ? this.w : -14;
      projs.push(new Projectile(this.x + ox, this.y + this.h / 2 - 6,
        this.facing * 11, 0, 'magic', 30));
      this.mana -= 20;
      this.magicCD = 28;
      playSound('magic');
    }

    // ── Ataque especial ───────────────────────────────────
    if (keys['l'] && this.hasSpecial && this.specialCharge >= 100 && this.specialCD <= 0) {
      // Dispara em 8 direções
      for (let i = 0; i < 8; i++) {
        const ang = (i / 8) * Math.PI * 2;
        projs.push(new Projectile(this.x + this.w / 2, this.y + this.h / 2,
          Math.cos(ang) * 9, Math.sin(ang) * 9, 'special', 55));
      }
      this.specialCharge = 0;
      this.specialCD = 100;
      playSound('special');
    }

    // ── Escudo ───────────────────────────────────────────
    if (this.shieldTimer > 0) {
      this.shieldTimer--;
      if (this.shieldTimer <= 0) this.hasShield = false;
    }

    // ── Cooldowns ─────────────────────────────────────────
    if (this.shootCD  > 0) this.shootCD--;
    if (this.magicCD  > 0) this.magicCD--;
    if (this.specialCD> 0) this.specialCD--;
    if (this.invincible>0) this.invincible--;

    // ── Física ───────────────────────────────────────────
    this.vy += GRAVITY;
    this.x  += this.vx;
    this.y  += this.vy;

    // Colisão com plataformas
    this.onGround = applyPlatformCollision(this, platforms);

    // Limites laterais
    if (this.x < 0) this.x = 0;
    if (this.x > levelWidth - this.w) this.x = levelWidth - this.w;

    // Caiu no buraco / lava → perde vida e volta
    if (this.y > H + 80) {
      this.takeDamage(40);
      this.x = Math.max(100, cameraX + 80);
      this.y = 200;
      this.vy = 0;
    }

    // Dano de spikes
    for (const p of platforms) {
      if (p.spike && overlaps(this, p)) {
        this.takeDamage(2);
      }
    }

    // Recuperação lenta de mana
    this.mana = Math.min(this.maxMana, this.mana + 0.05);

    // Animação
    this.animT++;
    if (this.animT >= 8) { this.animT = 0; this.animF = (this.animF + 1) % 4; }
  }

  takeDamage(dmg) {
    if (this.invincible > 0) return;
    if (this.hasShield) dmg = Math.ceil(dmg * 0.4);
    this.hp -= dmg;
    this.invincible = 55;
    if (this.hp <= 0) this.hp = 0;
    playSound('hurt');
  }

  draw() {
    // Pisca quando invencível
    if (this.invincible > 0 && Math.floor(this.invincible / 4) % 2 === 1) return;

    const sx = this.x - cameraX;
    const sy = this.y;
    const f  = this.facing;

    // Escudo visual
    if (this.hasShield) {
      ctx.strokeStyle = '#00e5ff';
      ctx.lineWidth = 3;
      ctx.shadowColor = '#00e5ff';
      ctx.shadowBlur = 12;
      ctx.beginPath();
      ctx.arc(sx + this.w / 2, sy + this.h / 2, this.w * 0.85, 0, Math.PI * 2);
      ctx.stroke();
      ctx.shadowBlur = 0;
    }

    // Pernas (animadas)
    const legAnim = this.onGround ? Math.sin(this.animF * 1.6) * 4 : 0;
    ctx.fillStyle = '#2c3e50';
    ctx.fillRect(sx + 5,          sy + this.h - 12, 10, 12 + legAnim);
    ctx.fillRect(sx + this.w - 15, sy + this.h - 12, 10, 12 - legAnim);

    // Corpo (camisa azul)
    ctx.fillStyle = '#2980b9';
    ctx.fillRect(sx + 3, sy + 18, this.w - 6, 18);

    // Braços
    ctx.fillStyle = '#F5CBA7';
    if (f > 0) {
      ctx.fillRect(sx + this.w - 1, sy + 20, 8, 10); // braço direito
      ctx.fillRect(sx - 7,          sy + 20, 8, 10); // braço esquerdo
    } else {
      ctx.fillRect(sx - 7,          sy + 20, 8, 10);
      ctx.fillRect(sx + this.w - 1, sy + 20, 8, 10);
    }

    // Cabeça (pele)
    ctx.fillStyle = '#F5CBA7';
    ctx.fillRect(sx + 4, sy + 2, this.w - 8, 17);

    // Cabelo marrom
    ctx.fillStyle = '#6E2C00';
    ctx.fillRect(sx + 4,  sy + 2, this.w - 8, 6);
    ctx.fillRect(sx + 4,  sy + 2, 5, 10);   // franja lateral

    // Olhos
    ctx.fillStyle = '#1a1a1a';
    const eyeOffX = f > 0 ? 6 : 4;
    ctx.fillRect(sx + eyeOffX,      sy + 10, 4, 4);
    ctx.fillRect(sx + eyeOffX + 10, sy + 10, 4, 4);
  }
}

// ─────────────────────────────────────────────────────────────
//  INIMIGO
// ─────────────────────────────────────────────────────────────
const ENEMY_DEF = {
  zombie:       { w:28, h:38, hp:50,  spd:1.3, dmg:8,  col:'#27ae60', col2:'#1e8449', pts:100, label:'Zumbi'        },
  monster:      { w:32, h:42, hp:70,  spd:2.1, dmg:12, col:'#e67e22', col2:'#ca6f1e', pts:150, label:'Monstro'      },
  strongMonster:{ w:38, h:48, hp:100, spd:1.6, dmg:18, col:'#c0392b', col2:'#922b21', pts:200, label:'Monstro Forte'},
  shooter:      { w:30, h:38, hp:80,  spd:0.5, dmg:5,  col:'#8e44ad', col2:'#6c3483', pts:180, label:'Atirador'     },
};

class Enemy {
  constructor(x, y, type) {
    const d = ENEMY_DEF[type];
    Object.assign(this, d);
    this.x = x; this.y = y;
    this.maxHp = d.hp;
    this.type  = type;
    this.vx = 0; this.vy = 0;
    this.onGround = false;
    this.dead     = false;
    this.facing   = -1;
    this.shootCD  = 60 + Math.random() * 60;
    this.animT = 0; this.animF = 0;
  }

  update(player) {
    const dx   = player.x - this.x;
    const dist = Math.abs(dx);

    if (this.type === 'shooter') {
      // Fica parado e atira se estiver perto
      if (dist < 500) {
        this.facing = dx > 0 ? 1 : -1;
        this.shootCD--;
        if (this.shootCD <= 0) {
          this.shootCD = 90 + Math.random() * 60;
          const ox = this.facing > 0 ? this.w : -8;
          projs.push(new Projectile(this.x + ox, this.y + this.h / 2 - 4,
            this.facing * 5, 0, 'enemy', this.dmg));
        }
      }
      this.vx *= 0.8;
    } else {
      // Persegue o jogador
      if (dist < 500) {
        this.facing = dx > 0 ? 1 : -1;
        this.vx = this.facing * this.spd;
      } else {
        this.vx *= 0.8;
      }
    }

    this.vy += GRAVITY;
    this.x  += this.vx;
    this.y  += this.vy;
    this.onGround = applyPlatformCollision(this, platforms);

    if (this.y > H + 150) this.dead = true;

    this.animT++;
    if (this.animT >= 10) { this.animT = 0; this.animF = (this.animF + 1) % 4; }
  }

  takeDamage(dmg) {
    this.hp -= dmg;
    if (this.hp <= 0) { this.dead = true; return true; }
    return false;
  }

  draw() {
    const sx = this.x - cameraX;
    const sy = this.y;

    // Pernas animadas
    const leg = this.onGround ? Math.sin(this.animF * 1.5) * 3 : 0;
    ctx.fillStyle = this.col2;
    ctx.fillRect(sx + 4,          sy + this.h - 10, 9, 10 + leg);
    ctx.fillRect(sx + this.w - 13, sy + this.h - 10, 9, 10 - leg);

    // Corpo
    ctx.fillStyle = this.col;
    ctx.fillRect(sx + 2, sy + 12, this.w - 4, this.h - 22);

    // Cabeça
    ctx.fillStyle = this.col;
    ctx.fillRect(sx + 4, sy, this.w - 8, 14);

    // Olhos vermelhos
    ctx.fillStyle = '#ff1a1a';
    ctx.shadowColor = '#ff1a1a';
    ctx.shadowBlur = 6;
    const eyeX = this.facing > 0 ? sx + this.w - 14 : sx + 5;
    ctx.fillRect(eyeX, sy + 3, 5, 5);
    ctx.shadowBlur = 0;

    // Barra de HP pequena
    const bw = this.w;
    const ratio = this.hp / this.maxHp;
    ctx.fillStyle = '#333';
    ctx.fillRect(sx, sy - 8, bw, 4);
    ctx.fillStyle = ratio > 0.5 ? '#2ecc71' : ratio > 0.25 ? '#f39c12' : '#e74c3c';
    ctx.fillRect(sx, sy - 8, bw * ratio, 4);
  }
}

// ─────────────────────────────────────────────────────────────
//  CHEFE
// ─────────────────────────────────────────────────────────────
const BOSS_DEF = {
  // Fase 1
  midBoss1: { w:52, h:66, hp:200, spd:1.6, dmg:15, col:'#1abc9c', col2:'#148f77', pts:500,  label:'Zumbi Grande'       },
  boss1:    { w:60, h:76, hp:500, spd:1.8, dmg:22, col:'#27ae60', col2:'#1e8449', pts:1000, label:'Monstro da Floresta' },
  // Fase 2
  midBoss2: { w:44, h:56, hp:200, spd:3.2, dmg:14, col:'#7f8c8d', col2:'#616a6b', pts:500,  label:'Zumbi Corredor'     },
  boss2:    { w:68, h:84, hp:500, spd:1.6, dmg:28, col:'#95a5a6', col2:'#717d7e', pts:1000, label:'Gigante da Cidade'  },
  // Fase 3
  midBoss3: { w:48, h:60, hp:200, spd:1.9, dmg:18, col:'#8e44ad', col2:'#6c3483', pts:500,  label:'Monstro da Biblioteca'},
  boss3:    { w:58, h:74, hp:500, spd:2.0, dmg:25, col:'#2c3e50', col2:'#1a252f', pts:1000, label:'Diretor Zumbi'      },
  // Fase 4
  midBoss4: { w:50, h:66, hp:200, spd:1.6, dmg:22, col:'#bdc3c7', col2:'#95a5a6', pts:500,  label:'Robô Infectado'     },
  boss4:    { w:56, h:72, hp:500, spd:2.2, dmg:28, col:'#16a085', col2:'#0e6655', pts:1000, label:'Cientista Mutante'  },
  // Fase 5
  midBoss5: { w:58, h:74, hp:200, spd:2.4, dmg:26, col:'#e74c3c', col2:'#cb4335', pts:500,  label:'Guardião do Portal' },
  boss5:    { w:66, h:82, hp:500, spd:2.1, dmg:32, col:'#922b21', col2:'#7b241c', pts:1000, label:'Rei dos Zumbis'     },
  finalBoss:{ w:84, h:104,hp:1000,spd:2.6, dmg:38, col:'#1a1a2e', col2:'#0d0d1a', pts:5000, label:'Senhor dos Monstros'},
};

class Boss {
  constructor(x, y, type) {
    const d = BOSS_DEF[type];
    Object.assign(this, d);
    this.x = x; this.y = y;
    this.maxHp = d.hp;
    this.type  = type;
    this.vx = 0; this.vy = 0;
    this.onGround = false;
    this.dead     = false;
    this.facing   = -1;
    this.attackCD = 80 + Math.random() * 40;
    this.jumpCD   = 120;
    this.spawnCD  = 300;  // para chefão final
    this.animT = 0; this.animF = 0;
  }

  update(player) {
    const dx = player.x - this.x;
    this.facing = dx > 0 ? 1 : -1;

    // Movimento — persegue o jogador
    this.vx = this.facing * this.spd;

    // Ataques ranged
    this.attackCD--;
    if (this.attackCD <= 0) {
      this.attackCD = 70 + Math.random() * 60;
      this.fireAttack(player);
    }

    // Pulo ocasional
    this.jumpCD--;
    if (this.jumpCD <= 0 && this.onGround) {
      this.jumpCD = 100 + Math.random() * 80;
      this.vy = -14;
    }

    // Chefão final invoca inimigos
    if (this.type === 'finalBoss') {
      this.spawnCD--;
      if (this.spawnCD <= 0 && enemies.length < 6) {
        this.spawnCD = 280;
        const types = ['zombie', 'monster', 'strongMonster'];
        enemies.push(new Enemy(
          this.x + (Math.random() - 0.5) * 120,
          this.y - 50,
          types[Math.floor(Math.random() * types.length)]
        ));
      }
    }

    this.vy += GRAVITY;
    this.x  += this.vx;
    this.y  += this.vy;
    this.onGround = applyPlatformCollision(this, platforms);

    // Limite de mapa horizontal
    if (this.x < cameraX) this.x = cameraX;
    if (this.x + this.w > cameraX + W) this.x = cameraX + W - this.w;

    // Segurança: se o chefe cair no buraco, volta para o chão
    if (this.y > H) {
      this.y = 350;
      this.x = Math.max(cameraX + 100, Math.min(this.x, cameraX + W - this.w - 100));
      this.vy = 0;
    }

    this.animT++;
    if (this.animT >= 12) { this.animT = 0; this.animF = (this.animF + 1) % 4; }
  }

  fireAttack(player) {
    const ox = this.facing > 0 ? this.w : -9;
    const baseSpd = 6 + (currentPhase * 0.5);

    // Tiro principal
    projs.push(new Projectile(
      this.x + ox, this.y + this.h / 2,
      this.facing * baseSpd, 0, 'boss', this.dmg
    ));

    // Chefão final atira em leque
    if (this.type === 'finalBoss') {
      for (let i = -2; i <= 2; i++) {
        projs.push(new Projectile(
          this.x + this.w / 2, this.y + this.h / 2,
          this.facing * baseSpd, i * 2.5, 'boss', Math.ceil(this.dmg * 0.6)
        ));
      }
    }
  }

  takeDamage(dmg) {
    this.hp -= dmg;
    if (this.hp <= 0) { this.dead = true; return true; }
    return false;
  }

  draw() {
    const sx = this.x - cameraX;
    const sy = this.y;

    // Pernas
    const leg = this.onGround ? Math.sin(this.animF * 1.4) * 5 : 0;
    ctx.fillStyle = this.col2;
    ctx.fillRect(sx + 6,          sy + this.h - 16, 14, 16 + leg);
    ctx.fillRect(sx + this.w - 20, sy + this.h - 16, 14, 16 - leg);

    // Corpo
    ctx.fillStyle = this.col;
    ctx.fillRect(sx, sy + this.h * 0.3, this.w, this.h * 0.7 - 16);

    // Cabeça
    ctx.fillStyle = this.col;
    ctx.fillRect(sx + this.w * 0.1, sy, this.w * 0.8, this.h * 0.32);

    // Braços
    ctx.fillStyle = this.col2;
    ctx.fillRect(sx - 12, sy + this.h * 0.33, 12, this.h * 0.28);
    ctx.fillRect(sx + this.w, sy + this.h * 0.33, 12, this.h * 0.28);

    // Olhos brilhantes
    ctx.fillStyle = '#ff2200';
    ctx.shadowColor = '#ff2200';
    ctx.shadowBlur = 14;
    const eyeX = this.facing > 0
      ? sx + this.w * 0.55
      : sx + this.w * 0.18;
    ctx.fillRect(eyeX, sy + this.h * 0.07, this.w * 0.2, this.h * 0.12);
    ctx.shadowBlur = 0;

    // Coroa (chefes finais)
    if (this.type === 'boss5' || this.type === 'finalBoss') {
      ctx.fillStyle = '#FFD700';
      ctx.fillRect(sx + this.w * 0.15, sy - 16, this.w * 0.7, 16);
      ctx.fillRect(sx + this.w * 0.25, sy - 26, this.w * 0.14, 12);
      ctx.fillRect(sx + this.w * 0.45, sy - 30, this.w * 0.14, 16);
      ctx.fillRect(sx + this.w * 0.65, sy - 26, this.w * 0.14, 12);
    }

    // Aura do chefão final
    if (this.type === 'finalBoss') {
      const t = Date.now() * 0.003;
      ctx.strokeStyle = `hsl(${(t * 60) % 360}, 100%, 50%)`;
      ctx.lineWidth = 3;
      ctx.shadowColor = ctx.strokeStyle;
      ctx.shadowBlur = 20;
      ctx.beginPath();
      ctx.arc(sx + this.w / 2, sy + this.h / 2, this.w * 0.85 + Math.sin(t) * 8, 0, Math.PI * 2);
      ctx.stroke();
      ctx.shadowBlur = 0;
    }
  }
}

// ─────────────────────────────────────────────────────────────
//  DADOS DAS 5 FASES
// ─────────────────────────────────────────────────────────────
function buildPhase(idx) {
  const phases = [

    // ── FASE 1 – Floresta Sombria ──────────────────────────
    {
      name: 'Floresta Sombria',
      bg1: '#0d1a0d', bg2: '#162016',
      width: 3800,
      platforms: [
        // Chão contínuo
        { x:0,    y:450, w:4000, h:60 },
        // Plataformas flutuantes
        { x:200,  y:360, w:110, h:18 },
        { x:420,  y:300, w:90,  h:18 },
        { x:650,  y:350, w:100, h:18 },
        { x:900,  y:310, w:110, h:18 },
        { x:1150, y:270, w:90,  h:18 },
        { x:1400, y:330, w:100, h:18 },
        { x:1700, y:290, w:110, h:18 },
        { x:1950, y:250, w:90,  h:18 },
        { x:2200, y:310, w:100, h:18 },
        { x:2450, y:270, w:110, h:18 },
        { x:2700, y:330, w:90,  h:18 },
        { x:2950, y:280, w:100, h:18 },
        { x:3200, y:350, w:110, h:18 },
      ],
      enemies: [
        {x:500,  y:410, t:'zombie'}, {x:750,  y:410, t:'zombie'},
        {x:1000, y:410, t:'zombie'}, {x:1200, y:410, t:'zombie'},
        {x:1500, y:410, t:'zombie'}, {x:1800, y:410, t:'zombie'},
        {x:2000, y:410, t:'zombie'}, {x:2300, y:410, t:'zombie'},
        {x:2550, y:410, t:'zombie'}, {x:2800, y:410, t:'zombie'},
      ],
      midBossX: 1400, midBossType: 'midBoss1',
      bossX:    3100, bossType:    'boss1',
      items: [
        {x:300,  y:420, t:'heart'},   {x:650,  y:420, t:'coin'},
        {x:950,  y:420, t:'coin'},    {x:1200, y:240, t:'crystal'},
        {x:1800, y:420, t:'heart'},   {x:2450, y:240, t:'coin'},
        {x:2950, y:250, t:'key'},
        // Armas e poderes da Fase 1
        {x:700,  y:270, t:'weapon2'},     // tiro duplo atrás do 1º chefe
        {x:2200, y:280, t:'speedBoots'},  // botas antes do chefe final
      ],
    },

    // ── FASE 2 – Cidade Abandonada ─────────────────────────
    {
      name: 'Cidade Abandonada',
      bg1: '#0d0d1a', bg2: '#12122a',
      width: 3900,
      platforms: [
        { x:0,    y:450, w:4000, h:60 },
        { x:150,  y:370, w:100, h:18 },
        { x:380,  y:310, w:80,  h:18 },
        { x:600,  y:360, w:110, h:18 },
        { x:850,  y:290, w:100, h:18 },
        { x:1100, y:340, w:80,  h:18 },
        { x:1350, y:280, w:110, h:18 },
        { x:1650, y:330, w:100, h:18 },
        { x:1900, y:260, w:90,  h:18 },
        { x:2150, y:320, w:110, h:18 },
        { x:2400, y:270, w:80,  h:18 },
        { x:2650, y:340, w:100, h:18 },
        { x:2900, y:290, w:110, h:18 },
        { x:3150, y:360, w:100, h:18 },
      ],
      enemies: [
        {x:400,  y:410, t:'zombie'},  {x:620,  y:410, t:'monster'},
        {x:880,  y:410, t:'zombie'},  {x:1100, y:410, t:'monster'},
        {x:1380, y:410, t:'zombie'},  {x:1650, y:410, t:'monster'},
        {x:1900, y:410, t:'zombie'},  {x:2150, y:410, t:'monster'},
        {x:2400, y:410, t:'zombie'},  {x:2650, y:410, t:'monster'},
        {x:2900, y:410, t:'zombie'},
      ],
      midBossX: 1500, midBossType: 'midBoss2',
      bossX:    3200, bossType:    'boss2',
      items: [
        {x:250,  y:340, t:'heart'}, {x:550,  y:420, t:'coin'},
        {x:900,  y:260, t:'coin'},  {x:1350, y:250, t:'crystal'},
        {x:1700, y:230, t:'heart'}, {x:2200, y:290, t:'coin'},
        {x:2650, y:310, t:'coin'},  {x:3100, y:260, t:'key'},
        // Armas e poderes da Fase 2
        {x:600,  y:330, t:'rage'},        // fúria no início
        {x:1800, y:230, t:'weaponLaser'}, // laser após chefe médio
        {x:2800, y:260, t:'superJump'},   // super pulo perto do boss
      ],
    },

    // ── FASE 3 – Escola Assombrada ─────────────────────────
    {
      name: 'Escola Assombrada',
      bg1: '#1a0d2e', bg2: '#2c1a4a',
      width: 4000,
      platforms: [
        { x:0,    y:450, w:4200, h:60 },
        // Espinhos
        { x:200,  y:440, w:80,  h:20, spike:true },
        { x:600,  y:440, w:80,  h:20, spike:true },
        { x:1100, y:440, w:80,  h:20, spike:true },
        { x:1700, y:440, w:80,  h:20, spike:true },
        { x:2300, y:440, w:80,  h:20, spike:true },
        { x:2800, y:440, w:80,  h:20, spike:true },
        // Plataformas
        { x:100,  y:360, w:100, h:18 },
        { x:380,  y:300, w:80,  h:18 },
        { x:700,  y:350, w:110, h:18 },
        { x:950,  y:270, w:90,  h:18 },
        { x:1250, y:330, w:100, h:18 },
        { x:1500, y:280, w:110, h:18 },
        { x:1800, y:320, w:80,  h:18 },
        { x:2050, y:260, w:100, h:18 },
        { x:2350, y:310, w:110, h:18 },
        { x:2650, y:270, w:90,  h:18 },
        { x:2900, y:350, w:100, h:18 },
        { x:3200, y:300, w:110, h:18 },
      ],
      enemies: [
        {x:450,  y:410, t:'zombie'},       {x:700,  y:410, t:'monster'},
        {x:900,  y:410, t:'strongMonster'},{x:1150, y:410, t:'monster'},
        {x:1450, y:410, t:'strongMonster'},{x:1700, y:410, t:'zombie'},
        {x:1950, y:410, t:'strongMonster'},{x:2200, y:410, t:'monster'},
        {x:2500, y:410, t:'strongMonster'},{x:2750, y:410, t:'zombie'},
        {x:3000, y:410, t:'strongMonster'},
      ],
      midBossX: 1600, midBossType: 'midBoss3',
      bossX:    3300, bossType:    'boss3',
      items: [
        {x:180,  y:330, t:'heart'}, {x:500,  y:270, t:'coin'},
        {x:800,  y:320, t:'crystal'},{x:1100, y:240, t:'heart'},
        {x:1550, y:250, t:'coin'},  {x:2100, y:230, t:'crystal'},
        {x:2700, y:240, t:'heart'}, {x:3150, y:270, t:'key'},
        // Armas e poderes da Fase 3
        {x:450,  y:270, t:'speedBoots'},  // velocidade no início
        {x:1300, y:300, t:'weapon2'},     // tiro duplo no meio
        {x:2400, y:240, t:'rage'},        // fúria antes do boss
        {x:3000, y:320, t:'superJump'},   // super pulo na reta final
      ],
    },

    // ── FASE 4 – Laboratório Secreto ───────────────────────
    {
      name: 'Laboratório Secreto',
      bg1: '#020d1c', bg2: '#051020',
      width: 4200,
      platforms: [
        // Chão contínuo (chefes não caem mais)
        { x:0,    y:450, w:4300, h:60 },
        // Buracos como lava — só machucam o jogador, chefe passa por cima
        { x:700,  y:438, w:100, h:22, spike:true },
        { x:1150, y:438, w:100, h:22, spike:true },
        { x:1500, y:438, w:100, h:22, spike:true },
        { x:1950, y:438, w:100, h:22, spike:true },
        { x:2750, y:438, w:100, h:22, spike:true },
        // Plataformas no ar
        { x:100,  y:360, w:100, h:18 },
        { x:380,  y:290, w:90,  h:18 },
        { x:680,  y:340, w:100, h:18 },
        { x:940,  y:270, w:80,  h:18 },
        { x:1200, y:330, w:110, h:18 },
        { x:1480, y:275, w:90,  h:18 },
        { x:1750, y:330, w:100, h:18 },
        { x:2050, y:265, w:110, h:18 },
        { x:2350, y:320, w:80,  h:18 },
        { x:2650, y:280, w:100, h:18 },
        { x:2950, y:350, w:110, h:18 },
        { x:3250, y:290, w:100, h:18 },
        { x:3550, y:340, w:110, h:18 },
      ],
      enemies: [
        {x:400,  y:410, t:'monster'},      {x:650,  y:410, t:'strongMonster'},
        {x:900,  y:410, t:'shooter'},      {x:1150, y:410, t:'strongMonster'},
        {x:1400, y:410, t:'shooter'},      {x:1700, y:410, t:'strongMonster'},
        {x:1950, y:410, t:'shooter'},      {x:2200, y:410, t:'strongMonster'},
        {x:2500, y:410, t:'shooter'},      {x:2750, y:410, t:'strongMonster'},
        {x:3050, y:410, t:'shooter'},      {x:3350, y:410, t:'strongMonster'},
      ],
      midBossX: 1700, midBossType: 'midBoss4',
      bossX:    3500, bossType:    'boss4',
      items: [
        {x:150,  y:330, t:'heart'}, {x:450,  y:260, t:'coin'},
        {x:750,  y:310, t:'crystal'},{x:1100, y:240, t:'heart'},
        {x:1600, y:245, t:'crystal'},{x:2150, y:235, t:'coin'},
        {x:2700, y:250, t:'heart'}, {x:3400, y:260, t:'key'},
        // Armas e poderes da Fase 4
        {x:500,  y:260, t:'weaponLaser'}, // laser cedo
        {x:1300, y:245, t:'rage'},        // fúria no meio
        {x:2200, y:235, t:'weapon2'},     // tiro duplo
        {x:3200, y:260, t:'speedBoots'},  // velocidade no final
        {x:3800, y:310, t:'superJump'},   // super pulo antes do boss
      ],
    },

    // ── FASE 5 – Portal dos Monstros ───────────────────────
    {
      name: 'Portal dos Monstros',
      bg1: '#1a0000', bg2: '#0d0000',
      width: 4600,
      platforms: [
        { x:0,    y:450, w:600,  h:60 },
        { x:700,  y:450, w:300,  h:60 },
        { x:1100, y:450, w:400,  h:60 },
        { x:1600, y:450, w:500,  h:60 },
        { x:2200, y:450, w:350,  h:60 },
        { x:2650, y:450, w:600,  h:60 },
        { x:3350, y:450, w:500,  h:60 },
        { x:3950, y:450, w:700,  h:60 },
        // Lava (spike)
        { x:600,  y:460, w:100, h:40, spike:true },
        { x:1000, y:460, w:100, h:40, spike:true },
        { x:1500, y:460, w:100, h:40, spike:true },
        { x:2100, y:460, w:100, h:40, spike:true },
        { x:2550, y:460, w:100, h:40, spike:true },
        { x:3250, y:460, w:100, h:40, spike:true },
        { x:3850, y:460, w:100, h:40, spike:true },
        // Plataformas flutuantes
        { x:100,  y:340, w:100, h:18 },
        { x:380,  y:275, w:90,  h:18 },
        { x:680,  y:330, w:100, h:18 },
        { x:950,  y:265, w:80,  h:18 },
        { x:1250, y:315, w:110, h:18 },
        { x:1550, y:260, w:90,  h:18 },
        { x:1850, y:325, w:100, h:18 },
        { x:2150, y:265, w:110, h:18 },
        { x:2450, y:310, w:80,  h:18 },
        { x:2750, y:265, w:100, h:18 },
        { x:3050, y:330, w:110, h:18 },
        { x:3400, y:280, w:90,  h:18 },
        { x:3750, y:340, w:100, h:18 },
      ],
      enemies: [
        {x:450,  y:410, t:'zombie'},       {x:700,  y:410, t:'monster'},
        {x:900,  y:410, t:'strongMonster'},{x:1150, y:410, t:'shooter'},
        {x:1450, y:410, t:'strongMonster'},{x:1700, y:410, t:'shooter'},
        {x:1950, y:410, t:'zombie'},       {x:2200, y:410, t:'strongMonster'},
        {x:2500, y:410, t:'monster'},      {x:2750, y:410, t:'shooter'},
        {x:3050, y:410, t:'strongMonster'},{x:3350, y:410, t:'monster'},
        {x:3600, y:410, t:'zombie'},       {x:3900, y:410, t:'strongMonster'},
      ],
      midBossX:   1800, midBossType:  'midBoss5',
      extraBossX: 3000, extraBossType:'boss5',    // Rei dos Zumbis
      bossX:      4100, bossType:     'finalBoss',
      items: [
        {x:200,  y:310, t:'heart'}, {x:500,  y:245, t:'coin'},
        {x:800,  y:300, t:'crystal'},{x:1100, y:235, t:'heart'},
        {x:1500, y:230, t:'crystal'},{x:1950, y:295, t:'heart'},
        {x:2300, y:235, t:'crystal'},{x:2750, y:235, t:'heart'},
        {x:3200, y:300, t:'coin'},  {x:3700, y:250, t:'key'},
        // Armas e poderes da Fase 5 (muitos para ajudar na dificuldade)
        {x:400,  y:310, t:'rage'},
        {x:900,  y:235, t:'weaponLaser'},
        {x:1400, y:220, t:'weapon2'},
        {x:1900, y:295, t:'speedBoots'},
        {x:2500, y:280, t:'superJump'},
        {x:3000, y:300, t:'rage'},
        {x:3500, y:250, t:'weaponLaser'},
        {x:4000, y:310, t:'speedBoots'},
      ],
    },
  ];
  return phases[idx];
}

// ─────────────────────────────────────────────────────────────
//  INICIALIZAR FASE
// ─────────────────────────────────────────────────────────────
function initPhase(idx) {
  phaseData         = buildPhase(idx);
  levelWidth        = phaseData.width;
  platforms         = phaseData.platforms;
  enemies           = phaseData.enemies.map(e => new Enemy(e.x, e.y, e.t));
  items             = phaseData.items.map(i => new Item(i.x, i.y, i.t));
  bosses            = [];
  projs             = [];
  particles         = [];
  midBossSpawned    = false;
  midBossDefeated   = false;
  extraBossSpawned  = false;
  finalBossSpawned  = false;
}

// ─────────────────────────────────────────────────────────────
//  INICIAR / REINICIAR JOGO
// ─────────────────────────────────────────────────────────────
function startGame() {
  player       = new Player();
  score        = 0;
  cameraX      = 0;
  currentPhase = 0;
  initPhase(0);
  gameState = 'playing';
}

function restartCurrentPhase() {
  initPhase(currentPhase);
  cameraX   = 0;
  player.hp = 80;   // volta com vida parcial
  player.x  = 100;
  player.y  = 300;
  player.invincible = 120;
  gameState = 'playing';
}

// ─────────────────────────────────────────────────────────────
//  AVANÇAR PARA PRÓXIMA FASE
// ─────────────────────────────────────────────────────────────
const POWERS = [
  'Tiro Mais Forte',
  'Pulo Duplo',
  'Magia de Fogo 🔥',
  'Escudo Mágico 🛡',
  'Ataque Especial ⚡',
];

function unlockPower(idx) {
  powerMsg      = POWERS[idx];
  powerMsgTimer = 220;
  switch (idx) {
    case 0: player.shootPower = 2; break;
    case 1: player.doubleJump = true; player.canDJump = true; break;
    case 2: player.hasFireMagic = true; break;
    case 3: player.hasShield = true; player.shieldTimer = 99999; break;
    case 4: player.hasSpecial = true; break;
  }
}

function advancePhase() {
  if (currentPhase < 4) {
    unlockPower(currentPhase);
    currentPhase++;
    initPhase(currentPhase);
    cameraX  = 0;
    player.x = 100;
    player.y = 300;
    player.hp = Math.min(player.maxHp, player.hp + 60);
    player.invincible = 90;
  } else {
    gameState = 'victory';
    playSound('victory');
  }
}

// ─────────────────────────────────────────────────────────────
//  ATUALIZAÇÃO DO JOGO
// ─────────────────────────────────────────────────────────────
function update() {
  if (gameState !== 'playing') return;

  // ── Câmera suave ────────────────────────────────────────
  const targetCam = player.x - W * 0.35;
  cameraX += (Math.max(0, Math.min(targetCam, levelWidth - W)) - cameraX) * 0.1;

  // ── Spawnar chefes quando jogador se aproxima ────────────
  if (!midBossSpawned && player.x > phaseData.midBossX - 500) {
    bosses.push(new Boss(phaseData.midBossX, 350, phaseData.midBossType));
    midBossSpawned = true;
  }
  // Fase 5: Rei dos Zumbis (chefe extra)
  if (phaseData.extraBossX && !extraBossSpawned && player.x > phaseData.extraBossX - 500) {
    bosses.push(new Boss(phaseData.extraBossX, 330, phaseData.extraBossType));
    extraBossSpawned = true;
  }
  // Chefe final: só aparece depois do chefe médio ser derrotado
  if (!finalBossSpawned && midBossDefeated && player.x > phaseData.bossX - 600) {
    bosses.push(new Boss(phaseData.bossX, 300, phaseData.bossType));
    finalBossSpawned = true;
  }

  // ── Jogador ──────────────────────────────────────────────
  player.update();
  jumpPressed = false;   // consumir o jump

  if (player.hp <= 0) {
    gameState = 'gameOver';
    return;
  }

  // ── Projéteis ────────────────────────────────────────────
  for (const p of projs) p.update();
  projs = projs.filter(p => !p.dead);

  // ── Inimigos ─────────────────────────────────────────────
  for (const e of enemies) {
    e.update(player);
    // Dano por contato
    if (overlaps(player, e)) player.takeDamage(e.dmg / 10);
  }

  // ── Chefes ───────────────────────────────────────────────
  for (const b of bosses) {
    b.update(player);
    if (overlaps(player, b)) player.takeDamage(b.dmg / 10);
  }

  // ── Colisão projéteis do jogador → inimigos/chefes ───────
  for (const proj of projs) {
    if (proj.owner === 'player' || proj.owner === 'magic' || proj.owner === 'special' || proj.owner === 'laser') {
      const isLaser = proj.owner === 'laser';

      for (const e of enemies) {
        if (!e.dead && overlaps(proj, e)) {
          const killed = e.takeDamage(proj.damage);
          if (!isLaser) proj.dead = true;  // laser não para ao acertar
          burst(e.x + e.w / 2, e.y + e.h / 2, e.col, 6);
          playSound('hit');
          if (killed) {
            score += e.pts;
            player.specialCharge = Math.min(100, player.specialCharge + 8);
            if (Math.random() < 0.22) {
              const drop = ['coin', 'heart', 'crystal'][Math.floor(Math.random() * 3)];
              items.push(new Item(e.x + e.w / 2, e.y, drop));
            }
          }
          if (!isLaser) break;
        }
      }

      for (const b of bosses) {
        if (!b.dead && overlaps(proj, b)) {
          const killed = b.takeDamage(proj.damage);
          proj.dead = true;
          burst(b.x + b.w / 2, b.y + b.h / 2, b.col, 10);
          playSound('hit');
          score += 5;
          player.specialCharge = Math.min(100, player.specialCharge + 5);

          if (killed) {
            score += b.pts;
            burst(b.x + b.w / 2, b.y + b.h / 2, '#FFD700', 24);
            playSound('victory');

            if (b.type.startsWith('midBoss')) {
              // Chefe médio derrotado → checkpoint + cura
              midBossDefeated = true;
              items.push(new Item(b.x,      b.y - 30, 'heart'));
              items.push(new Item(b.x + 35, b.y - 30, 'heart'));
            } else {
              // Chefe final da fase derrotado
              setTimeout(advancePhase, 1800);
            }
          }
          break;
        }
      }
    }

    // ── Projéteis inimigos → jogador ────────────────────────
    if ((proj.owner === 'enemy' || proj.owner === 'boss') && overlaps(proj, player)) {
      player.takeDamage(proj.damage);
      proj.dead = true;
    }
  }

  enemies = enemies.filter(e => !e.dead);
  bosses  = bosses.filter(b => !b.dead);

  // ── Itens ─────────────────────────────────────────────────
  for (const item of items) {
    item.update();
    if (!item.collected && overlaps(player, item)) {
      item.collected = true;
      burst(item.x + 11, item.y + 11, '#FFD700', 6);
      playSound('collect');
      switch (item.type) {
        case 'heart':   player.hp = Math.min(player.maxHp, player.hp + 30); break;
        case 'coin':    score += 50; break;
        case 'crystal': player.mana = Math.min(player.maxMana, player.mana + 35); break;
        case 'key':     score += 500; break;
        case 'shield':
          player.hasShield = true;
          player.shieldTimer = 400;
          break;
        // ── Novas armas e poderes coletáveis ─────────────────
        case 'weapon2':
          // Tiro duplo: atira dois projéteis lado a lado
          player.shootPower = Math.max(player.shootPower, 2);
          player.weaponMode = 'double';
          powerMsg = '🔫 Tiro Duplo!';
          powerMsgTimer = 140;
          break;
        case 'weaponLaser':
          // Laser: tiro que atravessa inimigos, dura 15 segundos
          player.weaponMode = 'laser';
          player.laserTimer = 900;  // ~15 segundos a 60fps
          powerMsg = '⚡ Laser Desbloqueado!';
          powerMsgTimer = 140;
          break;
        case 'speedBoots':
          // Velocidade: move 40% mais rápido por 10 segundos
          player.speedBoost = 600;
          powerMsg = '👟 Super Velocidade!';
          powerMsgTimer = 140;
          break;
        case 'superJump':
          // Super pulo: pulo muito mais alto por 10 segundos
          player.superJumpTimer = 600;
          powerMsg = '⬆ Super Pulo!';
          powerMsgTimer = 140;
          break;
        case 'rage':
          // Fúria: dano dobrado por 8 segundos
          player.rageTimer = 480;
          powerMsg = '💢 MODO FÚRIA!';
          powerMsgTimer = 140;
          break;
      }
    }
  }
  items = items.filter(i => !i.collected);

  // ── Partículas ────────────────────────────────────────────
  for (const p of particles) p.update();
  particles = particles.filter(p => p.life > 0);

  // ── Mensagem de poder ─────────────────────────────────────
  if (powerMsgTimer > 0) powerMsgTimer--;

  // ── Recarga automática do especial ───────────────────────
  if (player.hasSpecial) {
    player.specialCharge = Math.min(100, player.specialCharge + 0.03);
  }
}

// ─────────────────────────────────────────────────────────────
//  DESENHO DO CENÁRIO
// ─────────────────────────────────────────────────────────────
function drawBackground() {
  // Gradiente de fundo
  const grad = ctx.createLinearGradient(0, 0, 0, H);
  grad.addColorStop(0, phaseData.bg1);
  grad.addColorStop(1, phaseData.bg2);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, W, H);

  // Detalhes de fundo por fase
  if (currentPhase === 0) drawForest();
  if (currentPhase === 1) drawCity();
  if (currentPhase === 2) drawSchool();
  if (currentPhase === 3) drawLab();
  if (currentPhase === 4) drawPortal();
}

function drawForest() {
  const t = Date.now() * 0.0005;
  // Lua
  ctx.fillStyle = '#fffff0';
  ctx.shadowColor = '#ffffaa';
  ctx.shadowBlur = 30;
  ctx.beginPath();
  ctx.arc(W - 90, 70, 35, 0, Math.PI * 2);
  ctx.fill();
  ctx.shadowBlur = 0;
  // Árvores paralaxadas
  ctx.fillStyle = '#0d2b0d';
  for (let i = 0; i < 14; i++) {
    const tx = ((i * 220 - cameraX * 0.25 + 4000) % (W + 260)) - 80;
    const th = 80 + (i % 3) * 50;
    ctx.fillStyle = '#3d1f0a';
    ctx.fillRect(tx + 18, H - 60 - th + 25, 18, th);
    ctx.fillStyle = `hsl(130, ${30 + (i % 4) * 5}%, 15%)`;
    ctx.fillRect(tx - 5,  H - 60 - th,       58, th * 0.65);
    ctx.fillRect(tx,      H - 60 - th + 25,  48, 40);
  }
}

function drawCity() {
  // Estrelas
  ctx.fillStyle = '#fff';
  for (let i = 0; i < 40; i++) {
    const sx = (i * 137 + 50) % W;
    const sy = (i * 83  + 20) % (H * 0.6);
    ctx.fillRect(sx, sy, 2, 2);
  }
  // Prédios
  for (let i = 0; i < 10; i++) {
    const bx  = ((i * 150 - cameraX * 0.2 + 3000) % (W + 160)) - 80;
    const bh  = 90 + (i % 4) * 55;
    ctx.fillStyle = `hsl(220, 18%, ${12 + (i % 3) * 4}%)`;
    ctx.fillRect(bx, H - 60 - bh, 90, bh);
    // Janelas
    ctx.fillStyle = 'rgba(255,230,80,0.25)';
    for (let wy = 15; wy < bh - 10; wy += 28) {
      for (let wx = 8; wx < 75; wx += 22) {
        ctx.fillRect(bx + wx, H - 60 - bh + wy, 12, 12);
      }
    }
  }
}

function drawSchool() {
  // Lua assustadora
  ctx.fillStyle = '#cc8800';
  ctx.shadowColor = '#ff6600';
  ctx.shadowBlur = 40;
  ctx.beginPath();
  ctx.arc(80, 70, 38, 0, Math.PI * 2);
  ctx.fill();
  ctx.shadowBlur = 0;
  // Prédio escola no fundo
  for (let i = 0; i < 6; i++) {
    const bx = ((i * 220 - cameraX * 0.15 + 3000) % (W + 240)) - 80;
    ctx.fillStyle = '#2a1a3a';
    ctx.fillRect(bx, H - 240, 180, 180);
    ctx.fillStyle = '#ff4400';
    for (let j = 0; j < 4; j++) {
      ctx.fillRect(bx + 15 + j * 40, H - 215, 24, 30);
    }
  }
}

function drawLab() {
  // Grade de laboratório
  ctx.strokeStyle = 'rgba(0,180,255,0.07)';
  ctx.lineWidth = 1;
  const gOff = (-cameraX * 0.08) % 50;
  for (let x = gOff; x < W; x += 50) {
    ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke();
  }
  for (let y = 0; y < H; y += 50) {
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke();
  }
  // Tubos e máquinas
  ctx.fillStyle = '#0a2a4a';
  for (let i = 0; i < 8; i++) {
    const bx = ((i * 200 - cameraX * 0.1 + 2000) % (W + 220)) - 80;
    ctx.fillRect(bx, H - 180, 60, 120);
    ctx.fillStyle = '#00aaff';
    ctx.fillRect(bx + 10, H - 170, 40, 10);
    ctx.fillStyle = '#0a2a4a';
  }
}

function drawPortal() {
  // Lava no fundo
  const t = Date.now() * 0.002;
  ctx.fillStyle = '#cc2200';
  ctx.fillRect(0, H - 50, W, 50);
  // Bolhas de lava
  for (let i = 0; i < 8; i++) {
    const bx = ((i * 110 - cameraX * 0.3 + 2000) % (W + 110)) - 30;
    const by = H - 50 + Math.sin(t + i) * 5;
    ctx.fillStyle = '#ff4400';
    ctx.beginPath();
    ctx.arc(bx + 30, by, 14, Math.PI, 0);
    ctx.fill();
  }
  // Portal girante
  const px = W * 0.6;
  const py = H * 0.42;
  for (let r = 180; r > 10; r -= 22) {
    const hue = ((t * 60 + r) % 360);
    ctx.strokeStyle = `hsla(${hue},100%,55%,${0.06 + r / 1800})`;
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.arc(px, py, r, 0, Math.PI * 2);
    ctx.stroke();
  }
}

function drawPlatforms() {
  const PLAT_COLORS = [
    ['#3d6b21','#2c5018'],  // Floresta
    ['#555','#3a3a3a'],      // Cidade
    ['#5a3a7a','#40286a'],  // Escola
    ['#1a4a7a','#0d3060'],  // Lab
    ['#6a1010','#4a0808'],  // Portal
  ];
  const [c1, c2] = PLAT_COLORS[currentPhase] || PLAT_COLORS[0];

  for (const p of platforms) {
    const px = p.x - cameraX;
    if (px + p.w < -10 || px > W + 10) continue;

    if (p.spike) {
      // Lava / espinhos
      const lavaCol = currentPhase === 4 ? '#cc2200' : '#880000';
      ctx.fillStyle = lavaCol;
      ctx.fillRect(px, p.y, p.w, p.h);
      ctx.fillStyle = currentPhase === 4 ? '#ff4400' : '#cc0000';
      for (let sx = px; sx < px + p.w; sx += 16) {
        ctx.beginPath();
        ctx.moveTo(sx,      p.y);
        ctx.lineTo(sx + 8,  p.y - 12);
        ctx.lineTo(sx + 16, p.y);
        ctx.fill();
      }
    } else {
      ctx.fillStyle = c1;
      ctx.fillRect(px, p.y, p.w, p.h);
      ctx.fillStyle = c2;
      ctx.fillRect(px, p.y, p.w, 5);
      // Textura de tijolinho
      ctx.fillStyle = 'rgba(0,0,0,0.15)';
      for (let bx = px + 4; bx < px + p.w; bx += 28) {
        ctx.fillRect(bx, p.y + 6, 1, p.h - 6);
      }
    }
  }
}

// ─────────────────────────────────────────────────────────────
//  HUD
// ─────────────────────────────────────────────────────────────

// Etiqueta compacta de poder ativo (canto esquerdo)
function drawPowerTag(label, timer, color, y) {
  ctx.fillStyle = 'rgba(0,0,0,0.55)';
  ctx.fillRect(10, y, 148, 18);
  ctx.fillStyle = color;
  ctx.font = 'bold 11px monospace';
  ctx.textAlign = 'left';
  ctx.fillText(`${label}  (${timer})`, 14, y + 13);
}

function drawHUD() {
  // ── Barra de vida do Gabriel ────────────────────────────
  ctx.fillStyle = 'rgba(0,0,0,0.55)';
  ctx.fillRect(10, 10, 206, 22);
  const hpR = player.hp / player.maxHp;
  ctx.fillStyle = hpR > 0.5 ? '#2ecc71' : hpR > 0.25 ? '#f39c12' : '#e74c3c';
  ctx.fillRect(12, 12, 202 * hpR, 18);
  ctx.strokeStyle = '#fff';
  ctx.lineWidth = 1;
  ctx.strokeRect(10, 10, 206, 22);
  ctx.fillStyle = '#fff';
  ctx.font = 'bold 11px monospace';
  ctx.textAlign = 'left';
  ctx.fillText(`❤ ${player.hp} / ${player.maxHp}`, 15, 26);

  // ── Mana ─────────────────────────────────────────────────
  if (player.hasFireMagic) {
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.fillRect(10, 36, 156, 14);
    ctx.fillStyle = '#ff6b00';
    ctx.fillRect(12, 38, 152 * (player.mana / player.maxMana), 10);
    ctx.strokeStyle = '#ff6b00';
    ctx.strokeRect(10, 36, 156, 14);
    ctx.fillStyle = '#ff6b00';
    ctx.font = '10px monospace';
    ctx.fillText(`🔥 ${Math.floor(player.mana)}`, 15, 48);
  }

  // ── Especial ─────────────────────────────────────────────
  if (player.hasSpecial) {
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.fillRect(10, 54, 156, 14);
    ctx.fillStyle = '#00e5ff';
    ctx.fillRect(12, 56, 152 * (player.specialCharge / 100), 10);
    ctx.strokeStyle = '#00e5ff';
    ctx.strokeRect(10, 54, 156, 14);
    ctx.fillStyle = '#00e5ff';
    ctx.font = '10px monospace';
    ctx.fillText(`⚡ ${Math.floor(player.specialCharge)}%`, 15, 66);
  }

  // ── Fase e pontuação ──────────────────────────────────────
  ctx.fillStyle = '#ecf0f1';
  ctx.font = 'bold 13px monospace';
  ctx.textAlign = 'right';
  ctx.fillText(`Fase ${currentPhase + 1} — ${phaseData.name}`, W - 10, 22);
  ctx.fillText(`Pontos: ${score}`, W - 10, 40);

  // ── Barra de vida do chefe (TOPO, centralizada) ───────────
  const activeBoss = bosses.find(b => !b.dead);
  if (activeBoss) {
    const bw     = 360;
    const bx     = (W - bw) / 2;
    const by     = 6;
    const bRatio = activeBoss.hp / activeBoss.maxHp;
    const bc     = activeBoss.type === 'finalBoss' ? '#9b59b6' : '#e74c3c';

    // Fundo semi-transparente
    ctx.fillStyle = 'rgba(0,0,0,0.72)';
    ctx.fillRect(bx - 4, by - 2, bw + 8, 38);

    // Barra colorida
    ctx.fillStyle = bc;
    ctx.shadowColor = bc;
    ctx.shadowBlur = 14;
    ctx.fillRect(bx, by + 16, bw * bRatio, 16);
    ctx.shadowBlur = 0;

    // Borda
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 2;
    ctx.strokeRect(bx, by + 16, bw, 16);

    // Nome e HP do chefe acima da barra
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 12px monospace';
    ctx.textAlign = 'center';
    ctx.fillText(`👹 ${activeBoss.label}  ${activeBoss.hp} / ${activeBoss.maxHp}`, W / 2, by + 13);
  }

  ctx.textAlign = 'left';

  // ── Indicadores de poderes temporários ativos ────────────
  let powerY = 80;
  if (player.speedBoost > 0) {
    drawPowerTag('👟 Velocidade', `${Math.ceil(player.speedBoost / 60)}s`, '#2ecc71', powerY);
    powerY += 22;
  }
  if (player.superJumpTimer > 0) {
    drawPowerTag('⬆ Super Pulo', `${Math.ceil(player.superJumpTimer / 60)}s`, '#9b59b6', powerY);
    powerY += 22;
  }
  if (player.rageTimer > 0) {
    drawPowerTag('💢 Fúria', `${Math.ceil(player.rageTimer / 60)}s`, '#e74c3c', powerY);
    powerY += 22;
  }
  if (player.laserTimer > 0) {
    drawPowerTag('⚡ Laser', `${Math.ceil(player.laserTimer / 60)}s`, '#00e5ff', powerY);
    powerY += 22;
  }
  if (player.weaponMode === 'double' && player.laserTimer === 0) {
    drawPowerTag('🔫 Tiro Duplo', 'ativo', '#e67e22', powerY);
  }

  // ── Mensagem de poder desbloqueado ───────────────────────
  if (powerMsgTimer > 0) {
    const alpha = Math.min(1, powerMsgTimer / 40);
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.fillStyle = '#FFD700';
    ctx.shadowColor = '#FFD700';
    ctx.shadowBlur = 20;
    ctx.font = 'bold 22px monospace';
    ctx.textAlign = 'center';
    ctx.fillText(`✨ Poder desbloqueado: ${powerMsg}`, W / 2, H / 2 - 60);
    ctx.shadowBlur = 0;
    // Nome da nova fase
    if (powerMsgTimer > 150) {
      ctx.font = 'bold 26px monospace';
      ctx.fillStyle = '#fff';
      ctx.fillText(`Fase ${currentPhase + 1}: ${phaseData.name}`, W / 2, H / 2 - 20);
    }
    ctx.restore();
  }
}

// ─────────────────────────────────────────────────────────────
//  TELAS ESPECIAIS
// ─────────────────────────────────────────────────────────────
function drawMenu() {
  // Fundo estrelado animado
  ctx.fillStyle = '#07071a';
  ctx.fillRect(0, 0, W, H);
  const t = Date.now() * 0.0008;
  for (let i = 0; i < 60; i++) {
    const sx = (i * 137 + 50) % W;
    const sy = (i * 83  + 30) % (H * 0.7);
    ctx.fillStyle = `rgba(255,255,255,${0.3 + Math.sin(t + i) * 0.3})`;
    ctx.fillRect(sx, sy, 2, 2);
  }

  // Título com cor animada
  ctx.font = 'bold 38px monospace';
  ctx.textAlign = 'center';
  ctx.fillStyle = `hsl(${(t * 50) % 360}, 90%, 65%)`;
  ctx.shadowColor = '#fff';
  ctx.shadowBlur = 20;
  ctx.fillText('Gabriel Contra os Monstros', W / 2, 110);
  ctx.shadowBlur = 0;

  // Gabriel de exemplo
  drawMiniGabriel(W / 2 - 16, 130);

  // Descrição
  ctx.fillStyle = '#ccc';
  ctx.font = '15px monospace';
  ctx.fillText('Ajude Gabriel a sobreviver aos monstros,', W / 2, 230);
  ctx.fillText('coletar poderes e derrotar o chefão final!', W / 2, 252);

  // Botão COMEÇAR
  drawButton(W / 2 - 110, 285, 220, 52, '#27ae60', '#2ecc71', 'COMEÇAR', 22);

  // Controles
  ctx.fillStyle = '#7f8c8d';
  ctx.font = '12px monospace';
  ctx.fillText('A/D ou ←/→: Mover   W/↑/Espaço: Pular   J: Atirar', W / 2, 380);
  ctx.fillText('K: Magia    L: Especial (quando desbloqueados)', W / 2, 398);

  ctx.textAlign = 'left';
}

function drawMiniGabriel(x, y) {
  ctx.fillStyle = '#F5CBA7';
  ctx.fillRect(x + 4,  y,     24, 16);
  ctx.fillStyle = '#6E2C00';
  ctx.fillRect(x + 4,  y,     24, 6);
  ctx.fillStyle = '#2980b9';
  ctx.fillRect(x + 4,  y + 16, 24, 16);
  ctx.fillStyle = '#2c3e50';
  ctx.fillRect(x + 5,  y + 32, 9, 10);
  ctx.fillRect(x + 18, y + 32, 9, 10);
}

function drawGameOver() {
  ctx.fillStyle = 'rgba(0,0,0,0.82)';
  ctx.fillRect(0, 0, W, H);
  ctx.textAlign = 'center';
  ctx.fillStyle = '#e74c3c';
  ctx.shadowColor = '#e74c3c';
  ctx.shadowBlur = 30;
  ctx.font = 'bold 54px monospace';
  ctx.fillText('GAME OVER', W / 2, 170);
  ctx.shadowBlur = 0;
  ctx.fillStyle = '#ecf0f1';
  ctx.font = '18px monospace';
  ctx.fillText('Gabriel foi derrotado, mas pode tentar novamente!', W / 2, 230);
  ctx.font = '20px monospace';
  ctx.fillText(`Pontuação: ${score}`, W / 2, 268);
  drawButton(W / 2 - 120, 305, 240, 52, '#c0392b', '#e74c3c', 'REINICIAR FASE', 20);
  ctx.textAlign = 'left';
}

function drawVictory() {
  ctx.fillStyle = 'rgba(0,0,0,0.88)';
  ctx.fillRect(0, 0, W, H);
  ctx.textAlign = 'center';
  const t = Date.now() * 0.001;
  ctx.fillStyle = `hsl(${(t * 80) % 360},100%,60%)`;
  ctx.shadowColor = '#FFD700';
  ctx.shadowBlur = 35;
  ctx.font = 'bold 52px monospace';
  ctx.fillText('VOCÊ VENCEU! 🏆', W / 2, 155);
  ctx.shadowBlur = 0;
  ctx.fillStyle = '#FFD700';
  ctx.font = 'bold 20px monospace';
  ctx.fillText('Gabriel salvou todos os mundos dos monstros!', W / 2, 212);
  ctx.fillStyle = '#ecf0f1';
  ctx.font = '20px monospace';
  ctx.fillText(`Pontuação final: ${score}`, W / 2, 255);
  // Estrelas flutuantes
  for (let i = 0; i < 12; i++) {
    const sx2 = W / 2 + Math.cos(t * 0.8 + (i * Math.PI * 2) / 12) * 160;
    const sy2 = 320 + Math.sin(t * 0.8 + (i * Math.PI * 2) / 12) * 40;
    ctx.fillStyle = `hsl(${(i * 30) % 360},100%,70%)`;
    ctx.font = '22px monospace';
    ctx.fillText('★', sx2, sy2);
  }
  drawButton(W / 2 - 130, 370, 260, 54, '#1a6b3a', '#27ae60', 'JOGAR NOVAMENTE', 20);
  ctx.textAlign = 'left';
}

function drawButton(x, y, w, h, bg, border, label, fontSize) {
  ctx.fillStyle = bg;
  ctx.fillRect(x, y, w, h);
  ctx.strokeStyle = border;
  ctx.lineWidth = 3;
  ctx.strokeRect(x, y, w, h);
  ctx.fillStyle = '#fff';
  ctx.font = `bold ${fontSize}px monospace`;
  ctx.textAlign = 'center';
  ctx.fillText(label, x + w / 2, y + h / 2 + fontSize * 0.36);
}

// ─────────────────────────────────────────────────────────────
//  CLIQUES NOS BOTÕES
// ─────────────────────────────────────────────────────────────
canvas.addEventListener('click', e => {
  // Inicializa áudio na primeira interação
  getAudio();

  const r  = canvas.getBoundingClientRect();
  const cx = (e.clientX - r.left) * (W / r.width);
  const cy = (e.clientY - r.top)  * (H / r.height);

  if (gameState === 'menu') {
    if (cx > W/2-110 && cx < W/2+110 && cy > 285 && cy < 337) startGame();
  } else if (gameState === 'gameOver') {
    if (cx > W/2-120 && cx < W/2+120 && cy > 305 && cy < 357) restartCurrentPhase();
  } else if (gameState === 'victory') {
    if (cx > W/2-130 && cx < W/2+130 && cy > 370 && cy < 424) gameState = 'menu';
  }
});

// ─────────────────────────────────────────────────────────────
//  LOOP PRINCIPAL
// ─────────────────────────────────────────────────────────────
function draw() {
  ctx.clearRect(0, 0, W, H);

  if (gameState === 'menu')     { drawMenu();    return; }
  if (gameState === 'gameOver') { drawGameOver(); return; }
  if (gameState === 'victory')  { drawVictory(); return; }

  // ── Cenário ──────────────────────────────────────────────
  drawBackground();
  drawPlatforms();

  // ── Objetos ──────────────────────────────────────────────
  items.forEach(i => i.draw());
  enemies.forEach(e => e.draw());
  bosses.forEach(b => b.draw());
  player.draw();
  projs.forEach(p => p.draw());
  particles.forEach(p => p.draw());

  // ── Interface ────────────────────────────────────────────
  drawHUD();
}

function loop() {
  update();
  draw();
  requestAnimationFrame(loop);
}

// Iniciar o loop
loop();
