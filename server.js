require('dotenv').config();
const express = require('express');
const path = require('path');
const fs = require('fs');
const Anthropic = require('@anthropic-ai/sdk');
const multer = require('multer');
const XLSX = require('xlsx');
const QRCode = require('qrcode');

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

const app = express();
const PORT = process.env.PORT || 3000;

// ── Anthropic client ──────────────────────────────────────────────────────────
let anthropic = null;
if (process.env.ANTHROPIC_API_KEY) {
  anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
} else {
  console.warn('\n⚠️  ANTHROPIC_API_KEY no encontrada.');
  console.warn('   Para usar el escáner de planillas con IA:');
  console.warn('   1. Creá un archivo .env en la raíz del proyecto');
  console.warn('   2. Agregá: ANTHROPIC_API_KEY=sk-ant-...');
  console.warn('   3. Reiniciá el servidor\n');
}

// ── Base de datos ─────────────────────────────────────────────────────────────
const dataDir = path.join(__dirname, 'data');
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

const dbPath = path.join(dataDir, 'gimnasio.db');
let db;

// Intentar node:sqlite (built-in en Node.js >= 22.5, sin instalación)
try {
  const { DatabaseSync } = require('node:sqlite');
  db = new DatabaseSync(dbPath);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
  console.log('📦 SQLite: usando módulo built-in de Node.js');
} catch (e1) {
  // Fallback a better-sqlite3
  try {
    const Database = require('better-sqlite3');
    db = new Database(dbPath);
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    console.log('📦 SQLite: usando better-sqlite3');
  } catch (e2) {
    console.error('\n❌ No se pudo inicializar la base de datos.');
    console.error('   Soluciones (elegí una):');
    console.error('   1. Actualizá Node.js a la versión 22.5 o superior → https://nodejs.org');
    console.error('   2. O ejecutá: npm install --force');
    console.error(`\n   Error técnico: ${e2.message}\n`);
    process.exit(1);
  }
}

// Normalizar lastInsertRowid (node:sqlite devuelve BigInt, better-sqlite3 devuelve Number)
function lastId(result) {
  return Number(result.lastInsertRowid);
}

// ── Crear tablas ──────────────────────────────────────────────────────────────
db.exec(`
CREATE TABLE IF NOT EXISTS alumnos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nombre TEXT NOT NULL,
  nivel TEXT DEFAULT 'Principiante',
  objetivo TEXT,
  dias_por_semana INTEGER DEFAULT 4,
  limitaciones TEXT DEFAULT 'Ninguna',
  fecha_creacion TEXT DEFAULT (date('now'))
);

CREATE TABLE IF NOT EXISTS ciclos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  alumno_id INTEGER NOT NULL,
  numero_ciclo INTEGER DEFAULT 1,
  fecha_inicio TEXT,
  fecha_fin TEXT,
  estado TEXT DEFAULT 'activo',
  FOREIGN KEY (alumno_id) REFERENCES alumnos(id)
);

CREATE TABLE IF NOT EXISTS planes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ciclo_id INTEGER NOT NULL,
  tipo TEXT NOT NULL CHECK(tipo IN ('A','B')),
  entrada_en_calor TEXT,
  FOREIGN KEY (ciclo_id) REFERENCES ciclos(id)
);

CREATE TABLE IF NOT EXISTS circuitos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  plan_id INTEGER NOT NULL,
  orden INTEGER DEFAULT 1,
  series INTEGER DEFAULT 4,
  FOREIGN KEY (plan_id) REFERENCES planes(id)
);

CREATE TABLE IF NOT EXISTS ejercicios (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  circuito_id INTEGER NOT NULL,
  tipo TEXT NOT NULL CHECK(tipo IN ('principal','complemento')),
  nombre TEXT NOT NULL,
  notas TEXT,
  ejercicio_principal_id INTEGER,
  FOREIGN KEY (circuito_id) REFERENCES circuitos(id)
);

CREATE TABLE IF NOT EXISTS registros_visita (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ejercicio_id INTEGER NOT NULL,
  ciclo_id INTEGER NOT NULL,
  numero_visita INTEGER NOT NULL,
  fecha TEXT,
  reps INTEGER,
  pesos_por_serie TEXT,
  completado INTEGER DEFAULT 0,
  FOREIGN KEY (ejercicio_id) REFERENCES ejercicios(id),
  FOREIGN KEY (ciclo_id) REFERENCES ciclos(id)
);

CREATE TABLE IF NOT EXISTS pagos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  alumno_id INTEGER,
  mes INTEGER NOT NULL,
  ano INTEGER NOT NULL,
  monto REAL,
  fecha_pago TEXT,
  metodo TEXT DEFAULT 'transferencia',
  verificado INTEGER DEFAULT 0,
  concepto_extracto TEXT,
  observaciones TEXT,
  FOREIGN KEY (alumno_id) REFERENCES alumnos(id)
);

CREATE TABLE IF NOT EXISTS configuracion (
  clave TEXT PRIMARY KEY,
  valor TEXT
);

CREATE TABLE IF NOT EXISTS actividades (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nombre TEXT NOT NULL,
  cuota REAL NOT NULL DEFAULT 0
);
`);

// Migraciones para columnas nuevas (se ejecutan solo si no existen)
try { db.exec(`ALTER TABLE alumnos ADD COLUMN cuit TEXT`); } catch(e) {}
try { db.exec(`ALTER TABLE alumnos ADD COLUMN cuota_mensual REAL`); } catch(e) {}
try { db.exec(`ALTER TABLE alumnos ADD COLUMN dni TEXT`); } catch(e) {}
try { db.exec(`ALTER TABLE alumnos ADD COLUMN fecha_inicio TEXT`); } catch(e) {}
try { db.exec(`ALTER TABLE alumnos ADD COLUMN peso REAL`); } catch(e) {}
try { db.exec(`ALTER TABLE alumnos ADD COLUMN altura REAL`); } catch(e) {}
try { db.exec(`ALTER TABLE alumnos ADD COLUMN edad INTEGER`); } catch(e) {}
try { db.exec(`ALTER TABLE alumnos ADD COLUMN n_orden INTEGER`); } catch(e) {}
try { db.exec(`ALTER TABLE ejercicios ADD COLUMN peso_fin TEXT`); } catch(e) {}
try { db.exec(`ALTER TABLE ejercicios ADD COLUMN reps_fin TEXT`); } catch(e) {}
try { db.exec(`ALTER TABLE pagos RENAME COLUMN "año" TO ano`); } catch(e) {}
try { db.exec(`ALTER TABLE alumnos ADD COLUMN cuits_alternativos TEXT`); } catch(e) {}
try { db.exec(`ALTER TABLE alumnos ADD COLUMN actividad_id INTEGER`); } catch(e) {}

// ── Datos de ejemplo ──────────────────────────────────────────────────────────

// Helper reutilizable para insertar alumnos de ejemplo
function crearAlumnoEjemplo(nombre, nivel, objetivo, dias, limitaciones, fechaCreacion, cicloFechaInicio, planesData) {
  const existe = db.prepare('SELECT id FROM alumnos WHERE nombre = ?').get(nombre);
  if (existe) return;

  const stmtA = db.prepare(`INSERT INTO alumnos (nombre, nivel, objetivo, dias_por_semana, limitaciones, fecha_creacion) VALUES (?, ?, ?, ?, ?, ?)`);
  const alumnoId = lastId(stmtA.run(nombre, nivel, objetivo, dias, limitaciones, fechaCreacion));

  const cicloId = lastId(db.prepare(`INSERT INTO ciclos (alumno_id, numero_ciclo, fecha_inicio, estado) VALUES (?, 1, ?, 'activo')`).run(alumnoId, cicloFechaInicio));

  for (const plan of planesData) {
    const planId = lastId(db.prepare(`INSERT INTO planes (ciclo_id, tipo, entrada_en_calor) VALUES (?, ?, ?)`).run(cicloId, plan.tipo, plan.ec || null));

    for (let i = 0; i < plan.circuitos.length; i++) {
      const c = plan.circuitos[i];
      const circId = lastId(db.prepare(`INSERT INTO circuitos (plan_id, orden, series) VALUES (?, ?, ?)`).run(planId, i + 1, c.series || 4));

      const principalId = lastId(db.prepare(`INSERT INTO ejercicios (circuito_id, tipo, nombre, notas) VALUES (?, 'principal', ?, ?)`).run(circId, c.principal, c.notas || null));

      if (c.complemento) {
        db.prepare(`INSERT INTO ejercicios (circuito_id, tipo, nombre, notas, ejercicio_principal_id) VALUES (?, 'complemento', ?, ?, ?)`).run(circId, c.complemento, c.notasComp || null, principalId);
      }

      for (let v = 0; v < c.visitas.length; v++) {
        const vis = c.visitas[v];
        db.prepare(`INSERT INTO registros_visita (ejercicio_id, ciclo_id, numero_visita, fecha, reps, pesos_por_serie, completado) VALUES (?, ?, ?, ?, ?, ?, 1)`).run(principalId, cicloId, v + 1, vis.fecha, vis.reps, vis.pesos || null);
      }
    }
  }
  console.log(`✅ Datos de ejemplo cargados (alumno/a: ${nombre})`);
}

function cargarDatosEjemplo() {
  const count = db.prepare('SELECT COUNT(*) as c FROM alumnos').get();
  if (count.c > 0) {
    // Aunque ya haya datos, intentar agregar los nuevos ejemplos si faltan
    crearEjemplosMoniYBaru();
    return;
  }

  const insertAlumno = db.prepare(`
    INSERT INTO alumnos (nombre, nivel, objetivo, dias_por_semana, limitaciones, fecha_creacion)
    VALUES (?, ?, ?, ?, ?, ?)
  `);
  const alumnoId = lastId(insertAlumno.run(
    'Flor', 'Intermedio', 'Fuerza + glúteos', 4, 'Ninguna', '2026-05-13'
  ));

  const insertCiclo = db.prepare(`
    INSERT INTO ciclos (alumno_id, numero_ciclo, fecha_inicio, estado)
    VALUES (?, ?, ?, ?)
  `);
  const cicloId = lastId(insertCiclo.run(alumnoId, 1, '2026-05-13', 'activo'));

  const insertPlan = db.prepare(`INSERT INTO planes (ciclo_id, tipo, entrada_en_calor) VALUES (?, ?, ?)`);
  const insertCircuito = db.prepare(`INSERT INTO circuitos (plan_id, orden, series) VALUES (?, ?, ?)`);
  const insertEjercicio = db.prepare(`
    INSERT INTO ejercicios (circuito_id, tipo, nombre, notas, ejercicio_principal_id)
    VALUES (?, ?, ?, ?, ?)
  `);
  const insertVisita = db.prepare(`
    INSERT INTO registros_visita (ejercicio_id, ciclo_id, numero_visita, fecha, reps, pesos_por_serie, completado)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);

  // ── Plan A ──
  const ecA = 'Plancha incl. x10, mt sub/bajo pp (5+5), Sen y rusa x5';
  const planAId = lastId(insertPlan.run(cicloId, 'A', ecA));

  const planACircuitos = [
    {
      series: 4,
      principal: { nombre: 'Estocada fija c/manc', notas: '10,10,12,12 — reps: 4-6' },
      complemento: { nombre: 'Abs colgada (flexión)', notas: 'x8 reps' },
      visitas: 5
    },
    {
      series: 4,
      principal: { nombre: 'Hip Thrust c/barra', notas: '50,55,60,65 — reps: 6-8' },
      complemento: { nombre: 'Copa tríceps', notas: '27.5 kg — x8 reps' },
      visitas: 5
    },
    {
      series: 4,
      principal: { nombre: 'Press en puente glúteo c/banda', notas: '10,10,10,12 — reps: 6-8' },
      complemento: { nombre: 'Adducción c/máquina', notas: '16 kg — x10 reps' },
      visitas: 5
    }
  ];

  const pesosA = [
    ['10,10,12,12', '10,10,12,12', '10,10,12,12', '10,10,12,12', '10,10,12,12'],
    ['50,55,60,65', '50,55,60,65', '50,55,60,65', '50,55,60,65', '50,55,60,65'],
    ['10,10,10,12', '10,10,10,12', '10,10,10,12', '10,10,10,12', '10,10,10,12']
  ];

  planACircuitos.forEach((c, i) => {
    const circId = lastId(insertCircuito.run(planAId, i + 1, c.series));
    const principalId = lastId(insertEjercicio.run(circId, 'principal', c.principal.nombre, c.principal.notas, null));
    insertEjercicio.run(circId, 'complemento', c.complemento.nombre, c.complemento.notas, principalId);
    for (let v = 1; v <= c.visitas; v++) {
      insertVisita.run(principalId, cicloId, v, '2026-05-' + (12 + v), 5 + Math.floor(v / 4), pesosA[i][v - 1], 1);
    }
  });

  // ── Plan B ──
  const ecB = 'Idem Plan A';
  const planBId = lastId(insertPlan.run(cicloId, 'B', ecB));

  const planBCircuitos = [
    {
      series: 4,
      principal: { nombre: 'Búlgara c/manc inclinada', notas: '10,10,10,12 — reps: 4-6' },
      complemento: { nombre: 'Bíceps c/polea soga', notas: 'x6 reps' },
      visitas: 3
    },
    {
      series: 4,
      principal: { nombre: 'Semi-sumo c/barra', notas: '40,50,50,55 — reps: 4-6' },
      complemento: { nombre: 'Pecho muerto c/disco (en pp)', notas: 'x4 reps' },
      visitas: 3
    },
    {
      series: 4,
      principal: { nombre: 'Press c/máquina', notas: '20,20,25,25 — reps: 6-8' },
      complemento: { nombre: 'Prisionero c/mb (4+4)', notas: null },
      visitas: 3
    },
    {
      series: 4,
      principal: { nombre: 'Dorsalera (Ab)', notas: '25,25,25,25 — reps: 6-8' },
      complemento: { nombre: 'Pasos lat. c/banda + disco ext.', notas: 'x6 reps' },
      visitas: 3
    }
  ];

  const pesosB = [
    ['10,10,10,12', '10,10,10,12', '10,10,10,12'],
    ['40,50,50,55', '40,50,50,55', '40,50,50,55'],
    ['20,20,25,25', '20,20,25,25', '20,20,25,25'],
    ['25,25,25,25', '25,25,25,25', '25,25,25,25']
  ];

  planBCircuitos.forEach((c, i) => {
    const circId = lastId(insertCircuito.run(planBId, i + 1, c.series));
    const principalId = lastId(insertEjercicio.run(circId, 'principal', c.principal.nombre, c.principal.notas, null));
    insertEjercicio.run(circId, 'complemento', c.complemento.nombre, c.complemento.notas, principalId);
    for (let v = 1; v <= c.visitas; v++) {
      insertVisita.run(principalId, cicloId, v, '2026-05-' + (14 + v * 2), 5, pesosB[i][v - 1], 1);
    }
  });

  console.log('✅ Datos de ejemplo cargados (alumna: Flor)');
  crearEjemplosMoniYBaru();
}

function crearEjemplosMoniYBaru() {
  // ── MONI ────────────────────────────────────────────────────────────────────
  const fechasMoniA = ['2026-04-22','2026-04-25','2026-04-29','2026-05-03','2026-05-07','2026-05-10'];
  const fechasMoniB = ['2026-04-24','2026-04-27','2026-05-01','2026-05-05','2026-05-08','2026-05-12'];

  crearAlumnoEjemplo('Moni', 'Intermedio', null, 4, 'Ninguna', '2026-04-22', '2026-04-22', [
    {
      tipo: 'A',
      ec: 'Plancha 2 Apoyo (10"+10"), Lat Ingl. Subo/paso pp (3+3), Sent. Asim c/Rusa (3+3)',
      circuitos: [
        {
          series: 4,
          principal: 'Sentadilla B + Prensa Cuádriceps',
          notas: '50,60,60,60 — reps: 6-8',
          complemento: 'Bíceps en TRX',
          notasComp: 'x6',
          visitas: [
            { fecha: fechasMoniA[0], reps: 6, pesos: '50,60,60,60' },
            { fecha: fechasMoniA[1], reps: 7, pesos: '60,60,60,60' },
            { fecha: fechasMoniA[2], reps: 8, pesos: '60,60,60,60' },
            { fecha: fechasMoniA[3], reps: 6, pesos: '50,60,65,70' },
            { fecha: fechasMoniA[4], reps: 7, pesos: '60,65,65,70' },
            { fecha: fechasMoniA[5], reps: 8, pesos: '60,63,70,70' }
          ]
        },
        {
          series: 4,
          principal: 'Máquina Isquios',
          notas: '20,25,25,25 — reps: 6-8',
          complemento: 'Pasos Laterales c/banda',
          notasComp: 'x8',
          visitas: [
            { fecha: fechasMoniA[0], reps: 6, pesos: '20,25,25,25' },
            { fecha: fechasMoniA[1], reps: 7, pesos: '20,25,25,25' },
            { fecha: fechasMoniA[2], reps: 8, pesos: '20,25,25,25' },
            { fecha: fechasMoniA[3], reps: 6, pesos: '20,25,25,30' },
            { fecha: fechasMoniA[4], reps: 7, pesos: '20,25,25,30' },
            { fecha: fechasMoniA[5], reps: 8, pesos: '25,25,30,30' }
          ]
        },
        {
          series: 4,
          principal: 'Press glúteos c/Máquina',
          notas: '20,25,25,30 — reps: 6-8',
          complemento: 'Abs Bco Dec.',
          notasComp: 'x8',
          visitas: [
            { fecha: fechasMoniA[0], reps: 6, pesos: '20,25,25,30' },
            { fecha: fechasMoniA[1], reps: 7, pesos: '20,25,25,25' },
            { fecha: fechasMoniA[2], reps: 8, pesos: '20,25,25,25' },
            { fecha: fechasMoniA[3], reps: 6, pesos: '20,25,25,30' },
            { fecha: fechasMoniA[4], reps: 7, pesos: '20,25,25,30' },
            { fecha: fechasMoniA[5], reps: 8, pesos: '25,25,30,30' }
          ]
        },
        {
          series: 4,
          principal: 'Dorsalera Alterna',
          notas: '20,20,25,25 — reps: 3-6',
          complemento: 'Abducción c/Máquina',
          notasComp: 'x10',
          visitas: [
            { fecha: fechasMoniA[0], reps: 3, pesos: '20,20,25,25' },
            { fecha: fechasMoniA[1], reps: 4, pesos: '20,20,25,25' },
            { fecha: fechasMoniA[2], reps: 5, pesos: '20,25,25,25' },
            { fecha: fechasMoniA[3], reps: 6, pesos: '20,25,25,25' },
            { fecha: fechasMoniA[4], reps: 3, pesos: '25,25,30,30' },
            { fecha: fechasMoniA[5], reps: 4, pesos: '25,25,30,30' }
          ]
        }
      ]
    },
    {
      tipo: 'B',
      ec: 'Idem Plan A',
      circuitos: [
        {
          series: 4,
          principal: 'Sentadilla c/barra de punta + Press',
          notas: '10,10,10,10 — reps: 5-7',
          complemento: 'Elevación de cabeza a pp c/Mb (6+6)(8+8)',
          notasComp: null,
          visitas: [
            { fecha: fechasMoniB[0], reps: 5, pesos: '10,10,10,10' },
            { fecha: fechasMoniB[1], reps: 6, pesos: '10,10,10,10' },
            { fecha: fechasMoniB[2], reps: 7, pesos: '10,10,10,10' },
            { fecha: fechasMoniB[3], reps: 5, pesos: '10,10,15,15' },
            { fecha: fechasMoniB[4], reps: 6, pesos: '10,10,15,15' },
            { fecha: fechasMoniB[5], reps: 7, pesos: '10,15,15,15' }
          ]
        },
        {
          series: 4,
          principal: 'Sumo c/barra T',
          notas: '25,20,25,25 — reps: 5-7',
          complemento: 'Vuelos Frontal c/polea soga',
          notasComp: 'x6 a x8',
          visitas: [
            { fecha: fechasMoniB[0], reps: 5, pesos: '25,20,25,25' },
            { fecha: fechasMoniB[1], reps: 6, pesos: '25,20,25,25' },
            { fecha: fechasMoniB[2], reps: 7, pesos: '25,20,25,25' },
            { fecha: fechasMoniB[3], reps: 5, pesos: '20,25,30,30' },
            { fecha: fechasMoniB[4], reps: 6, pesos: '25,30,30,30' },
            { fecha: fechasMoniB[5], reps: 7, pesos: '25,25,30,30' }
          ]
        },
        {
          series: 4,
          principal: 'Press en puente de glúteos c/banda',
          notas: '7.5,7.5,10,10 — reps: 6-8',
          complemento: 'Conejos a pp en fib (5+5)',
          notasComp: 'x6 a x8',
          visitas: [
            { fecha: fechasMoniB[0], reps: 6, pesos: '7.5,7.5,10,10' },
            { fecha: fechasMoniB[1], reps: 7, pesos: '7.5,10,10,10' },
            { fecha: fechasMoniB[2], reps: 8, pesos: '10,10,10,12' },
            { fecha: fechasMoniB[3], reps: 6, pesos: '10,10,12,12' },
            { fecha: fechasMoniB[4], reps: 7, pesos: '10,12,12,12' },
            { fecha: fechasMoniB[5], reps: 8, pesos: '10,12,12,12' }
          ]
        },
        {
          series: 4,
          principal: 'Remo Renegado',
          notas: '7.5,7.5,7.5,10 — reps: 4-8',
          complemento: 'Plancha Spider en TRX',
          notasComp: '(5+5)',
          visitas: [
            { fecha: fechasMoniB[0], reps: 6, pesos: '7.5,7.5,7.5,10' },
            { fecha: fechasMoniB[1], reps: 7, pesos: '7.5,7.5,10,10' },
            { fecha: fechasMoniB[2], reps: 8, pesos: '7.5,10,10,10' },
            { fecha: fechasMoniB[3], reps: 4, pesos: '10,10,12,12' },
            { fecha: fechasMoniB[4], reps: 5, pesos: '10,10,12,12' },
            { fecha: fechasMoniB[5], reps: 6, pesos: '10,12,12,12' }
          ]
        }
      ]
    }
  ]);

  // ── BARU ────────────────────────────────────────────────────────────────────
  const fechasBaru = ['2026-05-12','2026-05-15','2026-05-19','2026-05-22','2026-05-26','2026-05-29'];

  crearAlumnoEjemplo('Baru', 'Intermedio', null, 3, 'Ninguna', '2026-05-12', '2026-05-12', [
    {
      tipo: 'A',
      ec: null,
      circuitos: [
        {
          series: 4,
          principal: 'Sentadilla c/barra adelante',
          notas: '30,40,50,50 — reps: 4-6',
          complemento: 'Flexiones de brazo desde barra',
          notasComp: 'x8',
          visitas: [
            { fecha: fechasBaru[0], reps: 4, pesos: '30,40,50,50' },
            { fecha: fechasBaru[1], reps: 5, pesos: '30,40,50,50' },
            { fecha: fechasBaru[2], reps: 6, pesos: '40,40,50,50' },
            { fecha: fechasBaru[3], reps: 4, pesos: '40,50,55,55' },
            { fecha: fechasBaru[4], reps: 5, pesos: '40,50,55,55' },
            { fecha: fechasBaru[5], reps: 4, pesos: '40,50,55,60' }
          ]
        },
        {
          series: 4,
          principal: 'Deslizadores Isquios',
          notas: 'SC — reps: 6-8',
          complemento: 'Espinales y Bastón',
          notasComp: 'x8',
          visitas: [
            { fecha: fechasBaru[0], reps: 6, pesos: null },
            { fecha: fechasBaru[1], reps: 6, pesos: null },
            { fecha: fechasBaru[2], reps: 6, pesos: null },
            { fecha: fechasBaru[3], reps: 7, pesos: null },
            { fecha: fechasBaru[4], reps: 7, pesos: null },
            { fecha: fechasBaru[5], reps: 7, pesos: null }
          ]
        },
        {
          series: 4,
          principal: 'Press Arnold a 2 BB',
          notas: '10,12,12,12 — reps: 6-8',
          complemento: 'Bicho muerto c/disco (mano) alt.',
          notasComp: '2x7',
          visitas: [
            { fecha: fechasBaru[0], reps: 6, pesos: '10,12,12,12' },
            { fecha: fechasBaru[1], reps: 7, pesos: '10,12,12,12' },
            { fecha: fechasBaru[2], reps: 8, pesos: '10,12,12,12' },
            { fecha: fechasBaru[3], reps: 4, pesos: '12,12,15,15' },
            { fecha: fechasBaru[4], reps: 5, pesos: '12,15,15,15' },
            { fecha: fechasBaru[5], reps: 6, pesos: '12,15,15,15' }
          ]
        },
        {
          series: 4,
          principal: 'Serrucho',
          notas: '20,25,25,27 — reps: 6-8',
          complemento: 'Elevación de cadera c/máquina invertida',
          notasComp: 'x8',
          visitas: [
            { fecha: fechasBaru[0], reps: 6, pesos: '20,25,25,27' },
            { fecha: fechasBaru[1], reps: 7, pesos: '20,25,25,27' },
            { fecha: fechasBaru[2], reps: 8, pesos: '20,25,25,27' },
            { fecha: fechasBaru[3], reps: 6, pesos: '20,27,27,27' },
            { fecha: fechasBaru[4], reps: 7, pesos: '20,27,27,27' },
            { fecha: fechasBaru[5], reps: 8, pesos: '20,27,27,27' }
          ]
        }
      ]
    }
  ]);
}

cargarDatosEjemplo();

// ── Middleware ─────────────────────────────────────────────────────────────────
app.use(express.json({ limit: '20mb' }));
const publicDir = path.join(__dirname, 'public');
app.use(express.static(publicDir));
app.get('/', (req, res) => res.sendFile(path.join(publicDir, 'index.html')));

// ── Helpers ───────────────────────────────────────────────────────────────────
function getCicloActivo(alumnoId) {
  return db.prepare(`SELECT * FROM ciclos WHERE alumno_id = ? AND estado = 'activo' ORDER BY id DESC LIMIT 1`).get(alumnoId);
}

function getProgresoCiclo(cicloId) {
  const principales = db.prepare(`
    SELECT e.id FROM ejercicios e
    JOIN circuitos c ON e.circuito_id = c.id
    JOIN planes p ON c.plan_id = p.id
    WHERE p.ciclo_id = ? AND e.tipo = 'principal'
  `).all(cicloId);

  if (principales.length === 0) return { total: 0, completadas: 0, porcentaje: 0 };

  let completadas = 0;
  for (const ej of principales) {
    const visitas = db.prepare(`SELECT COUNT(*) as c FROM registros_visita WHERE ejercicio_id = ? AND ciclo_id = ? AND completado = 1`).get(ej.id, cicloId);
    completadas += Math.min(visitas.c, 12);
  }

  const total = principales.length * 12;
  return {
    total,
    completadas,
    porcentaje: Math.round((completadas / total) * 100)
  };
}

function getCicloCompleto(cicloId) {
  const planes = db.prepare(`SELECT * FROM planes WHERE ciclo_id = ?`).all(cicloId);
  for (const plan of planes) {
    const circuitos = db.prepare(`SELECT * FROM circuitos WHERE plan_id = ? ORDER BY orden`).all(plan.id);
    plan.circuitos = circuitos.map(c => {
      const ejercicios = db.prepare(`SELECT * FROM ejercicios WHERE circuito_id = ?`).all(c.id);
      const principal = ejercicios.find(e => e.tipo === 'principal');
      const complemento = ejercicios.find(e => e.tipo === 'complemento');
      const visitas = principal
        ? db.prepare(`SELECT * FROM registros_visita WHERE ejercicio_id = ? AND ciclo_id = ? ORDER BY numero_visita`).all(principal.id, cicloId)
        : [];
      return { ...c, principal, complemento, visitas };
    });
  }
  return planes;
}

// ── API: Alumnos ──────────────────────────────────────────────────────────────
app.get('/api/alumnos', (req, res) => {
  try {
    const alumnos = db.prepare(`SELECT * FROM alumnos ORDER BY nombre`).all();
    const hoy = new Date();
    const mesActual = hoy.getMonth() + 1;
    const anoActual = hoy.getFullYear();
    const result = alumnos.map(a => {
      const ciclo = getCicloActivo(a.id);
      let estado = 'sin_ciclo';
      let progreso = { total: 0, completadas: 0, porcentaje: 0 };
      let planes = [];
      if (ciclo) {
        progreso = getProgresoCiclo(ciclo.id);
        estado = progreso.porcentaje === 100 ? 'ciclo_completo' : 'ciclo_activo';
        planes = db.prepare(`SELECT tipo FROM planes WHERE ciclo_id = ?`).all(ciclo.id).map(p => p.tipo);
      }
      const pago = db.prepare(`SELECT id, monto, metodo FROM pagos WHERE alumno_id=? AND mes=? AND ano=?`).get(a.id, mesActual, anoActual);
      return { ...a, ciclo, estado, progreso, planes, pago_mes_actual: pago || null };
    });
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/alumnos/:id', (req, res) => {
  try {
    const alumno = db.prepare(`SELECT * FROM alumnos WHERE id = ?`).get(req.params.id);
    if (!alumno) return res.status(404).json({ error: 'Alumno no encontrado' });
    const ciclo = getCicloActivo(alumno.id);
    let estado = 'sin_ciclo';
    let progreso = { total: 0, completadas: 0, porcentaje: 0 };
    let planes = [];
    if (ciclo) {
      progreso = getProgresoCiclo(ciclo.id);
      estado = progreso.porcentaje === 100 ? 'ciclo_completo' : 'ciclo_activo';
      planes = db.prepare(`SELECT tipo FROM planes WHERE ciclo_id = ?`).all(ciclo.id).map(p => p.tipo);
    }
    res.json({ ...alumno, ciclo, estado, progreso, planes });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/alumnos', (req, res) => {
  try {
    const { nombre, nivel, objetivo, dias_por_semana, limitaciones, cuit, cuota_mensual, dni, fecha_inicio, peso, altura, edad, n_orden } = req.body;
    if (!nombre) return res.status(400).json({ error: 'El nombre es requerido' });
    const stmt = db.prepare(`
      INSERT INTO alumnos (nombre, nivel, objetivo, dias_por_semana, limitaciones, cuit, cuota_mensual, dni, fecha_inicio, peso, altura, edad, n_orden)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const result = stmt.run(
      nombre, nivel || 'Principiante', objetivo || null, dias_por_semana || 3,
      limitaciones || null, cuit || null, cuota_mensual || null,
      dni || null, fecha_inicio || null, peso || null, altura || null, edad || null, n_orden || null
    );
    const alumno = db.prepare(`SELECT * FROM alumnos WHERE id = ?`).get(lastId(result));
    res.json(alumno);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.put('/api/alumnos/:id', (req, res) => {
  try {
    const { nombre, nivel, objetivo, dias_por_semana, limitaciones, cuit, cuota_mensual, dni, fecha_inicio, peso, altura, edad, n_orden, cuits_alternativos, actividad_id } = req.body;
    // Si tiene actividad asignada, la cuota viene de ahí (salvo override manual)
    let cuotaFinal = cuota_mensual || null;
    if (actividad_id) {
      const act = db.prepare('SELECT cuota FROM actividades WHERE id=?').get(actividad_id);
      if (act && !cuota_mensual) cuotaFinal = act.cuota;
    }
    db.prepare(`
      UPDATE alumnos SET nombre=?, nivel=?, objetivo=?, dias_por_semana=?, limitaciones=?,
      cuit=?, cuota_mensual=?, dni=?, fecha_inicio=?, peso=?, altura=?, edad=?, n_orden=?, cuits_alternativos=?, actividad_id=?
      WHERE id=?
    `).run(
      nombre, nivel || 'Principiante', objetivo || null, dias_por_semana || 3,
      limitaciones || null, cuit || null, cuotaFinal,
      dni || null, fecha_inicio || null, peso || null, altura || null, edad || null, n_orden || null,
      cuits_alternativos || null, actividad_id || null,
      req.params.id
    );
    const alumno = db.prepare(`SELECT * FROM alumnos WHERE id = ?`).get(req.params.id);
    res.json(alumno);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.delete('/api/alumnos/:id', (req, res) => {
  try {
    const id = req.params.id;
    // Borrar en cascada: registros_visita → ejercicios → circuitos → planes → ciclos → pagos → alumno
    const ciclos = db.prepare('SELECT id FROM ciclos WHERE alumno_id = ?').all(id);
    for (const ciclo of ciclos) {
      const planes = db.prepare('SELECT id FROM planes WHERE ciclo_id = ?').all(ciclo.id);
      for (const plan of planes) {
        const circs = db.prepare('SELECT id FROM circuitos WHERE plan_id = ?').all(plan.id);
        for (const circ of circs) {
          const ejercicios = db.prepare('SELECT id FROM ejercicios WHERE circuito_id = ?').all(circ.id);
          for (const ej of ejercicios) {
            db.prepare('DELETE FROM registros_visita WHERE ejercicio_id = ?').run(ej.id);
          }
          db.prepare('DELETE FROM ejercicios WHERE circuito_id = ?').run(circ.id);
        }
        db.prepare('DELETE FROM circuitos WHERE plan_id = ?').run(plan.id);
      }
      db.prepare('DELETE FROM planes WHERE ciclo_id = ?').run(ciclo.id);
    }
    db.prepare('DELETE FROM ciclos WHERE alumno_id = ?').run(id);
    db.prepare('DELETE FROM pagos WHERE alumno_id = ?').run(id);
    db.prepare('DELETE FROM alumnos WHERE id = ?').run(id);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── API: Ciclos ───────────────────────────────────────────────────────────────
app.get('/api/alumnos/:id/ciclo-activo', (req, res) => {
  try {
    const ciclo = getCicloActivo(req.params.id);
    if (!ciclo) return res.json(null);
    const planes = getCicloCompleto(ciclo.id);
    const progreso = getProgresoCiclo(ciclo.id);
    res.json({ ...ciclo, planes, progreso });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/alumnos/:id/ciclos', (req, res) => {
  try {
    const alumno = db.prepare(`SELECT * FROM alumnos WHERE id = ?`).get(req.params.id);
    if (!alumno) return res.status(404).json({ error: 'Alumno no encontrado' });

    // Cerrar ciclo activo anterior si existe
    db.prepare(`UPDATE ciclos SET estado='cerrado', fecha_fin=date('now') WHERE alumno_id=? AND estado='activo'`).run(alumno.id);

    const ultimoCiclo = db.prepare(`SELECT MAX(numero_ciclo) as max FROM ciclos WHERE alumno_id=?`).get(alumno.id);
    const numeroCiclo = (ultimoCiclo.max || 0) + 1;

    const cicloId = lastId(db.prepare(`
      INSERT INTO ciclos (alumno_id, numero_ciclo, fecha_inicio, estado)
      VALUES (?, ?, date('now'), 'activo')
    `).run(alumno.id, numeroCiclo));

    // Crear planes, circuitos y ejercicios desde el body
    const { planes } = req.body;
    if (planes && planes.length > 0) {
      for (const plan of planes) {
        const planId = lastId(db.prepare(`INSERT INTO planes (ciclo_id, tipo, entrada_en_calor) VALUES (?, ?, ?)`).run(cicloId, plan.tipo, plan.entrada_en_calor || null));
        if (plan.circuitos) {
          for (const circ of plan.circuitos) {
            const circId = lastId(db.prepare(`INSERT INTO circuitos (plan_id, orden, series) VALUES (?, ?, ?)`).run(planId, circ.orden, circ.series || 4));
            if (circ.principal) {
              db.prepare(`INSERT INTO ejercicios (circuito_id, tipo, nombre, notas) VALUES (?, 'principal', ?, ?)`).run(circId, circ.principal.nombre, circ.principal.notas || null);
            }
            if (circ.complemento) {
              const principal = db.prepare(`SELECT id FROM ejercicios WHERE circuito_id=? AND tipo='principal'`).get(circId);
              db.prepare(`INSERT INTO ejercicios (circuito_id, tipo, nombre, notas, ejercicio_principal_id) VALUES (?, 'complemento', ?, ?, ?)`).run(circId, circ.complemento.nombre, circ.complemento.notas || null, principal?.id || null);
            }
          }
        }
      }
    }

    const ciclo = db.prepare(`SELECT * FROM ciclos WHERE id=?`).get(cicloId);
    res.json({ ...ciclo, planes: getCicloCompleto(cicloId) });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.put('/api/ciclos/:id/cerrar', (req, res) => {
  try {
    db.prepare(`UPDATE ciclos SET estado='cerrado', fecha_fin=date('now') WHERE id=?`).run(req.params.id);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/alumnos/:id/ciclos', (req, res) => {
  try {
    const ciclos = db.prepare(`SELECT * FROM ciclos WHERE alumno_id=? ORDER BY numero_ciclo DESC`).all(req.params.id);
    res.json(ciclos);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── API: Planes, Circuitos, Ejercicios ────────────────────────────────────────
app.post('/api/planes', (req, res) => {
  try {
    const { ciclo_id, tipo, entrada_en_calor } = req.body;
    const id = lastId(db.prepare(`INSERT INTO planes (ciclo_id, tipo, entrada_en_calor) VALUES (?, ?, ?)`).run(ciclo_id, tipo, entrada_en_calor || null));
    res.json(db.prepare(`SELECT * FROM planes WHERE id=?`).get(id));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/circuitos', (req, res) => {
  try {
    const { plan_id, orden, series } = req.body;
    const id = lastId(db.prepare(`INSERT INTO circuitos (plan_id, orden, series) VALUES (?, ?, ?)`).run(plan_id, orden || 1, series || 4));
    res.json(db.prepare(`SELECT * FROM circuitos WHERE id=?`).get(id));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/ejercicios', (req, res) => {
  try {
    const { circuito_id, tipo, nombre, notas, ejercicio_principal_id } = req.body;
    const id = lastId(db.prepare(`INSERT INTO ejercicios (circuito_id, tipo, nombre, notas, ejercicio_principal_id) VALUES (?, ?, ?, ?, ?)`).run(circuito_id, tipo, nombre, notas || null, ejercicio_principal_id || null));
    res.json(db.prepare(`SELECT * FROM ejercicios WHERE id=?`).get(id));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── API: Registros de visita ──────────────────────────────────────────────────
app.post('/api/registros', (req, res) => {
  try {
    const { ejercicio_id, ciclo_id, numero_visita, reps, pesos_por_serie } = req.body;
    // Verificar si ya existe
    const existing = db.prepare(`SELECT * FROM registros_visita WHERE ejercicio_id=? AND ciclo_id=? AND numero_visita=?`).get(ejercicio_id, ciclo_id, numero_visita);
    if (existing) {
      db.prepare(`UPDATE registros_visita SET reps=?, pesos_por_serie=?, completado=1, fecha=date('now') WHERE id=?`).run(reps, pesos_por_serie, existing.id);
      return res.json(db.prepare(`SELECT * FROM registros_visita WHERE id=?`).get(existing.id));
    }
    const id = lastId(db.prepare(`
      INSERT INTO registros_visita (ejercicio_id, ciclo_id, numero_visita, fecha, reps, pesos_por_serie, completado)
      VALUES (?, ?, ?, date('now'), ?, ?, 1)
    `).run(ejercicio_id, ciclo_id, numero_visita, reps, pesos_por_serie));
    res.json(db.prepare(`SELECT * FROM registros_visita WHERE id=?`).get(id));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Guardar resultado final de un ejercicio (peso_fin + reps_fin)
app.put('/api/ejercicios/:id/resultado', (req, res) => {
  try {
    const { peso_fin, reps_fin } = req.body;
    db.prepare(`UPDATE ejercicios SET peso_fin=?, reps_fin=? WHERE id=?`)
      .run(peso_fin || null, reps_fin || null, req.params.id);
    res.json(db.prepare(`SELECT * FROM ejercicios WHERE id=?`).get(req.params.id));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.put('/api/registros/:id', (req, res) => {
  try {
    const { reps, pesos_por_serie } = req.body;
    db.prepare(`UPDATE registros_visita SET reps=?, pesos_por_serie=?, completado=1 WHERE id=?`).run(reps, pesos_por_serie, req.params.id);
    res.json(db.prepare(`SELECT * FROM registros_visita WHERE id=?`).get(req.params.id));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── API: Scan con IA ──────────────────────────────────────────────────────────
app.post('/api/scan', async (req, res) => {
  try {
    if (!anthropic) {
      return res.status(503).json({
        error: 'API key de Anthropic no configurada. Creá un archivo .env con ANTHROPIC_API_KEY=sk-ant-...'
      });
    }
    const { imagen } = req.body;
    if (!imagen) return res.status(400).json({ error: 'Se requiere una imagen en base64' });

    const base64Data = imagen.replace(/^data:image\/[a-z]+;base64,/, '');
    const mediaType = imagen.startsWith('data:image/png') ? 'image/png' : 'image/jpeg';

    const message = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 2000,
      system: `Sos un asistente especializado en leer planillas de rutinas de gimnasio escritas a mano.
La planilla tiene este formato:
- Arriba: nombre del alumno, tipo de plan (A o B) y fecha
- Entrada en calor: lista de ejercicios de calentamiento
- Circuitos: cada circuito tiene un ejercicio principal (primer renglón) con sus pesos por serie
  (ej: 10 10 12 12 = 4 series con esos pesos) y sus repeticiones (van subiendo: 4→5→6 a lo largo del ciclo).
  Debajo del principal hay un ejercicio complementario con sus propias reps y a veces peso.
- El número grande a la izquierda (3 o 4) indica la cantidad de series del circuito.
- Los cuadraditos con colores solo marcan que esa visita se realizó, no tienen significado específico.

Devolvé ÚNICAMENTE un objeto JSON válido sin backticks ni texto adicional:
{
  "nombre": string | null,
  "plan": "A" | "B" | null,
  "fecha": string | null,
  "entrada_en_calor": string | null,
  "circuitos": [
    {
      "series": number,
      "principal": string,
      "pesos_por_serie": string,
      "rango_reps": string,
      "notas_principal": string | null,
      "complemento": string | null,
      "reps_complemento": string | null,
      "peso_complemento": string | null
    }
  ]
}`,
      messages: [{
        role: 'user',
        content: [{
          type: 'image',
          source: { type: 'base64', media_type: mediaType, data: base64Data }
        }, {
          type: 'text',
          text: 'Analizá esta planilla de rutina de gimnasio y extraé la información en el formato JSON indicado.'
        }]
      }]
    });

    const text = message.content[0].text.trim();
    let json;
    try {
      json = JSON.parse(text);
    } catch {
      const match = text.match(/\{[\s\S]*\}/);
      if (match) json = JSON.parse(match[0]);
      else throw new Error('No se pudo extraer JSON de la respuesta de IA');
    }
    res.json(json);
  } catch (e) {
    console.error('Error en /api/scan:', e.message);
    res.status(500).json({ error: e.message || 'Error al procesar la imagen con IA' });
  }
});

// ── API: Generar ciclo nuevo ───────────────────────────────────────────────────
app.post('/api/generar-ciclo/:alumno_id', async (req, res) => {
  try {
    const alumno = db.prepare('SELECT * FROM alumnos WHERE id = ?').get(req.params.alumno_id);
    if (!alumno) return res.status(404).json({ error: 'Alumno no encontrado' });

    const cicloActivo = getCicloActivo(req.params.alumno_id);
    if (!cicloActivo) return res.status(404).json({ error: 'No hay ciclo activo para este alumno' });

    // Historial completo de todos los ciclos
    const todosCiclos = db.prepare('SELECT * FROM ciclos WHERE alumno_id = ? ORDER BY numero_ciclo').all(alumno.id);
    const historial = todosCiclos.map(c => {
      const planes = getCicloCompleto(c.id);
      return {
        ciclo: c.numero_ciclo,
        estado: c.estado,
        fecha_inicio: c.fecha_inicio,
        planes: planes.map(p => ({
          tipo: p.tipo,
          circuitos: p.circuitos.map(circ => ({
            orden: circ.orden,
            series: circ.series,
            principal: circ.principal ? {
              nombre: circ.principal.nombre,
              inicio: circ.principal.notas,
              peso_final: circ.principal.peso_fin || null,
              reps_final: circ.principal.reps_fin || null
            } : null,
            complemento: circ.complemento ? {
              nombre: circ.complemento.nombre,
              notas: circ.complemento.notas,
              peso_final: circ.complemento.peso_fin || null,
              reps_final: circ.complemento.reps_fin || null
            } : null
          }))
        }))
      };
    });

    const numPlanes = getCicloCompleto(cicloActivo.id).length;

    // Sin API key: estructura en blanco pero con datos del ciclo anterior como referencia
    if (!anthropic) {
      const planesFallback = getCicloCompleto(cicloActivo.id).map(plan => ({
        tipo: plan.tipo,
        entrada_en_calor: '',
        circuitos: plan.circuitos.map(circ => ({
          orden: circ.orden,
          series: circ.series,
          principal: {
            nombre: '',
            nombre_anterior: circ.principal ? circ.principal.nombre : '',
            pesos_anteriores: circ.principal ? (circ.principal.peso_fin || circ.principal.notas || '') : '',
            reps_anteriores: circ.principal ? (circ.principal.reps_fin || '') : '',
            pesos_nuevos: '',
            reps_nuevas: '',
            razon: 'Completar manualmente'
          },
          complemento: circ.complemento ? {
            nombre: '',
            nombre_anterior: circ.complemento.nombre,
            notas: ''
          } : null
        }))
      }));
      return res.json({ alumno_id: parseInt(alumno.id), ciclo_anterior: cicloActivo.numero_ciclo, numero_ciclo_nuevo: cicloActivo.numero_ciclo + 1, propuesta: planesFallback });
    }

    const systemPrompt = `Sos un entrenador personal experto en disenar rutinas de gimnasio progresivas y personalizadas.
Tu tarea es analizar el historial completo de un alumno y proponer un NUEVO ciclo de entrenamiento.

REGLAS IMPORTANTES:
1. VARIA los ejercicios entre ciclos para evitar adaptacion. No repitas exactamente los mismos ejercicios a menos que sean fundamentales (ej: sentadilla, press banca).
2. Analiza que grupos musculares se trabajaron en los ciclos anteriores y busca equilibrio muscular.
3. Tene en cuenta el objetivo del alumno (fuerza, hipertrofia, perdida de peso, resistencia, etc).
4. Respeta las limitaciones fisicas (lesiones, condiciones medicas).
5. Ajusta la dificultad al nivel (Principiante / Intermedio / Avanzado).
6. Para cada ejercicio propone un peso inicial sugerido en base al historial (si aplica) y un rango de reps acorde al objetivo.
7. En el campo "razon" explica brevemente POR QUE elegiste ese ejercicio (que musculo trabaja, por que es apropiado para este alumno ahora).
8. Mantene la misma cantidad de planes (A, B, etc) y similar cantidad de circuitos que el ciclo anterior.
9. El formato de pesos es: numeros separados por coma para cada serie (ej: "20, 20, 25, 25").

Devuelve UNICAMENTE un JSON valido sin backticks ni texto adicional con esta estructura exacta:
{
  "propuesta": [
    {
      "tipo": "A",
      "entrada_en_calor": "descripcion del calentamiento",
      "circuitos": [
        {
          "orden": 1,
          "series": 4,
          "principal": {
            "nombre": "Nombre del ejercicio",
            "pesos_anteriores": "pesos del ciclo anterior o vacio si es nuevo",
            "reps_anteriores": "rango de reps anterior o vacio",
            "pesos_nuevos": "20, 20, 25, 25",
            "reps_nuevas": "8-10",
            "razon": "Explicacion del porque este ejercicio"
          },
          "complemento": {
            "nombre": "Nombre ejercicio complementario",
            "notas": "peso sugerido — reps: rango"
          }
        }
      ]
    }
  ]
}`;

    const userContent = `Datos del alumno:
- Nombre: ${alumno.nombre}
- Nivel: ${alumno.nivel}
- Edad: ${alumno.edad || 'no especificada'}
- Peso: ${alumno.peso ? alumno.peso + ' kg' : 'no especificado'}
- Altura: ${alumno.altura ? alumno.altura + ' cm' : 'no especificada'}
- Objetivo: ${alumno.objetivo || 'no especificado'}
- Limitaciones: ${alumno.limitaciones || 'ninguna'}
- Dias por semana: ${alumno.dias_por_semana}
- Cantidad de planes: ${numPlanes} (${numPlanes >= 2 ? 'Plan A y Plan B alternados' : 'solo Plan A'})
- Ciclo a generar: ${cicloActivo.numero_ciclo + 1}

Historial completo de ciclos:
${JSON.stringify(historial, null, 2)}`;

    const message = await anthropic.messages.create({
      model: 'claude-opus-4-5',
      max_tokens: 4000,
      system: systemPrompt,
      messages: [{ role: 'user', content: userContent }]
    });

    const text = message.content[0].text.trim();
    let aiResp;
    try {
      aiResp = JSON.parse(text);
    } catch {
      const match = text.match(/\{[\s\S]*\}/);
      if (match) aiResp = JSON.parse(match[0]);
      else throw new Error('No se pudo procesar la respuesta de IA');
    }

    res.json({
      alumno_id: parseInt(alumno.id),
      ciclo_anterior: cicloActivo.numero_ciclo,
      numero_ciclo_nuevo: cicloActivo.numero_ciclo + 1,
      propuesta: aiResp.propuesta
    });
  } catch (e) {
    console.error('Error en generar-ciclo:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// ── API: Importar Alumnos.xlsx ────────────────────────────────────────────────
// Parsea fechas del Excel: acepta DD/MM/YYYY, D/M/YYYY, número serial de Excel o ISO
function parsearFecha(valor) {
  if (!valor && valor !== 0) return null;
  // Número serial de Excel (ej: 44294)
  if (typeof valor === 'number' && valor > 1000) {
    const date = new Date(Math.round((valor - 25569) * 86400 * 1000));
    if (isNaN(date)) return null;
    return date.toISOString().slice(0, 10);
  }
  const s = String(valor).trim();
  if (!s) return null;
  // Formato DD/MM/YYYY o D/M/YYYY
  const m = s.match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})$/);
  if (m) {
    const [_, d, mo, y] = m;
    return `${y}-${mo.padStart(2,'0')}-${d.padStart(2,'0')}`;
  }
  // Ya está en ISO YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  return null;
}


app.post('/api/alumnos/importar-excel', upload.single('archivo'), (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No se recibió archivo' });

    const wb = XLSX.read(req.file.buffer, { type: 'buffer' });
    const ws = wb.Sheets[wb.SheetNames[0]];
    const filas = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });

    if (filas.length < 2) return res.status(400).json({ error: 'El archivo no tiene datos' });

    // Detectar encabezados (primera fila no vacía)
    let headerRow = 0;
    while (headerRow < filas.length && filas[headerRow].every(c => c === '')) headerRow++;
    const headers = filas[headerRow].map(h => String(h).toLowerCase().trim()
      .normalize('NFD').replace(/[̀-ͯ]/g, '') // quitar tildes
    );

    // Mapear columnas del Excel a campos de la BD
    const col = (terms) => {
      const t = Array.isArray(terms) ? terms : [terms];
      for (const term of t) {
        const idx = headers.findIndex(h => h.includes(term));
        if (idx !== -1) return idx;
      }
      return -1;
    };

    const iOrden    = col(['orden', 'n°', 'numero']);
    const iDni      = col(['dni']);
    const iNombre   = col(['nombre', 'apellido']);
    const iFechaIni = col(['inicio']);
    const iCuit     = col(['cuit', 'cuil']);
    const iMonto    = col(['monto', 'cuota']);
    const iPeso     = col(['peso']);
    const iAltura   = col(['altura', 'talla']);
    const iEdad     = col(['edad']);
    const iObjetivo = col(['objetivo']);

    if (iNombre === -1) return res.status(400).json({ error: 'No se encontró la columna de nombre/apellido en el Excel' });

    const creados = [], actualizados = [], errores = [];

    for (let r = headerRow + 1; r < filas.length; r++) {
      const fila = filas[r];
      const nombre = String(fila[iNombre] || '').trim();
      if (!nombre) continue;

      const datos = {
        nombre,
        n_orden:     iOrden !== -1    ? (parseInt(fila[iOrden]) || null) : null,
        dni:         iDni !== -1      ? String(fila[iDni] || '').trim() || null : null,
        fecha_inicio: iFechaIni !== -1 ? parsearFecha(fila[iFechaIni]) : null,
        cuit:        iCuit !== -1     ? String(fila[iCuit] || '').replace(/\D/g, '') || null : null,
        cuota_mensual: iMonto !== -1  ? (parseFloat(fila[iMonto]) || null) : null,
        peso:        iPeso !== -1     ? (parseFloat(fila[iPeso]) || null) : null,
        altura:      iAltura !== -1   ? (parseFloat(fila[iAltura]) || null) : null,
        edad:        iEdad !== -1     ? (parseInt(fila[iEdad]) || null) : null,
        objetivo:    iObjetivo !== -1 ? String(fila[iObjetivo] || '').trim() || null : null,
      };

      try {
        const existente = db.prepare(`SELECT id FROM alumnos WHERE LOWER(TRIM(nombre)) = LOWER(TRIM(?))`)
          .get(nombre);

        if (existente) {
          // Actualizar solo los campos que vienen del Excel (sin pisar rutinas/nivel/limitaciones)
          db.prepare(`
            UPDATE alumnos SET
              n_orden=COALESCE(?,n_orden), dni=COALESCE(?,dni), fecha_inicio=COALESCE(?,fecha_inicio),
              cuit=COALESCE(?,cuit), cuota_mensual=COALESCE(?,cuota_mensual),
              peso=COALESCE(?,peso), altura=COALESCE(?,altura), edad=COALESCE(?,edad),
              objetivo=COALESCE(?,objetivo)
            WHERE id=?
          `).run(
            datos.n_orden, datos.dni, datos.fecha_inicio,
            datos.cuit, datos.cuota_mensual,
            datos.peso, datos.altura, datos.edad, datos.objetivo,
            existente.id
          );
          actualizados.push(nombre);
        } else {
          db.prepare(`
            INSERT INTO alumnos (nombre, nivel, dias_por_semana, n_orden, dni, fecha_inicio, cuit, cuota_mensual, peso, altura, edad, objetivo)
            VALUES (?, 'Principiante', 3, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `).run(
            nombre, datos.n_orden, datos.dni, datos.fecha_inicio,
            datos.cuit, datos.cuota_mensual, datos.peso, datos.altura, datos.edad, datos.objetivo
          );
          creados.push(nombre);
        }
      } catch (e) {
        errores.push({ nombre, error: e.message });
      }
    }

    res.json({
      ok: true,
      creados: creados.length,
      actualizados: actualizados.length,
      errores: errores.length,
      detalle: { creados, actualizados, errores },
      mensaje: `Importación completa: ${creados.length} alumnos nuevos, ${actualizados.length} actualizados.`
    });
  } catch (e) {
    console.error('Error importando Excel:', e.message);
    res.status(500).json({ error: 'Error al procesar el archivo: ' + e.message });
  }
});

// ── API: Configuración ────────────────────────────────────────────────────────
app.get('/api/configuracion', (req, res) => {
  try {
    const rows = db.prepare('SELECT clave, valor FROM configuracion').all();
    const config = {};
    rows.forEach(r => { config[r.clave] = r.valor; });
    res.json(config);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/configuracion', (req, res) => {
  try {
    const stmt = db.prepare('INSERT OR REPLACE INTO configuracion (clave, valor) VALUES (?, ?)');
    Object.entries(req.body).forEach(([k, v]) => stmt.run(k, v));
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── API: Actividades (tarifas) ────────────────────────────────────────────────
app.get('/api/actividades', (req, res) => {
  try {
    const acts = db.prepare('SELECT * FROM actividades ORDER BY nombre').all();
    // Agregar conteo de alumnos por actividad
    const result = acts.map(a => ({
      ...a,
      alumnos_count: db.prepare('SELECT COUNT(*) as c FROM alumnos WHERE actividad_id=?').get(a.id).c
    }));
    res.json(result);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/actividades', (req, res) => {
  try {
    const { nombre, cuota } = req.body;
    if (!nombre) return res.status(400).json({ error: 'El nombre es obligatorio' });
    const id = lastId(db.prepare('INSERT INTO actividades (nombre, cuota) VALUES (?, ?)').run(nombre, cuota || 0));
    res.json(db.prepare('SELECT * FROM actividades WHERE id=?').get(id));
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.put('/api/actividades/:id', (req, res) => {
  try {
    const { nombre, cuota, actualizar_alumnos } = req.body;
    db.prepare('UPDATE actividades SET nombre=?, cuota=? WHERE id=?').run(nombre, cuota || 0, req.params.id);
    // Si se pide, actualizar cuota_mensual de todos los alumnos con esta actividad
    if (actualizar_alumnos) {
      db.prepare('UPDATE alumnos SET cuota_mensual=? WHERE actividad_id=?').run(cuota || 0, req.params.id);
    }
    res.json(db.prepare('SELECT * FROM actividades WHERE id=?').get(req.params.id));
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/actividades/:id', (req, res) => {
  try {
    // Desasignar alumnos antes de borrar
    db.prepare('UPDATE alumnos SET actividad_id=NULL WHERE actividad_id=?').run(req.params.id);
    db.prepare('DELETE FROM actividades WHERE id=?').run(req.params.id);
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});


// ── API: Cobranza ─────────────────────────────────────────────────────────────
app.get('/api/cobranza/:ano/:mes', (req, res) => {
  try {
    const ano = req.params.ano || req.params['ã±o'];
    const mes = req.params.mes;
    const alumnos = db.prepare('SELECT id, nombre, cuit, cuota_mensual FROM alumnos ORDER BY nombre').all();
    const result = alumnos.map(a => {
      const pago = db.prepare('SELECT * FROM pagos WHERE alumno_id=? AND mes=? AND ano=?').get(a.id, mes, ano);
      return { ...a, pago: pago || null, estado: pago ? 'pagado' : 'pendiente' };
    });
    const totalCobrado = result.filter(a => a.pago).reduce((s, a) => s + (a.pago.monto || 0), 0);
    const pagaron = result.filter(a => a.pago).length;
    res.json({ alumnos: result, totalCobrado, pagaron, pendientes: result.length - pagaron });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/pagos', (req, res) => {
  try {
    const { alumno_id, mes, ano, monto, fecha_pago, metodo, observaciones } = req.body;
    db.prepare('DELETE FROM pagos WHERE alumno_id=? AND mes=? AND ano=?').run(alumno_id, mes, ano);
    const id = lastId(db.prepare(
      'INSERT INTO pagos (alumno_id, mes, ano, monto, fecha_pago, metodo, verificado, observaciones) VALUES (?, ?, ?, ?, ?, ?, 1, ?)'
    ).run(alumno_id, mes, ano, monto, fecha_pago || new Date().toISOString().slice(0,10), metodo || 'manual', observaciones || null));
    res.json(db.prepare('SELECT * FROM pagos WHERE id=?').get(id));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/pagos/:id', (req, res) => {
  try {
    db.prepare('DELETE FROM pagos WHERE id=?').run(req.params.id);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Normaliza texto: minúsculas, sin tildes, sin caracteres especiales
function normalizarTexto(s) {
  return String(s).toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ').trim();
}

// Busca coincidencia de nombre de alumno dentro de un texto (ej: descripción de MP)
// Devuelve true si al menos 2 palabras significativas del nombre están en el texto
function coincideNombre(nombreAlumno, texto) {
  const palabrasNombre = normalizarTexto(nombreAlumno)
    .split(' ').filter(p => p.length >= 3);
  if (palabrasNombre.length === 0) return false;
  const textoNorm = normalizarTexto(texto);
  const coincidencias = palabrasNombre.filter(p => textoNorm.includes(p));
  // Requiere que coincidan al menos 2 palabras, o todas si el nombre tiene solo 1 palabra larga
  return coincidencias.length >= Math.min(2, palabrasNombre.length);
}

// Extrae el CUIT (11 dígitos) del campo concepto de un movimiento bancario
function extraerCuit(concepto) {
  const patrones = [/\bD:(\d{11})\b/, /\((\d{11})\)/, /\bC:(\d{11})\b/, /\b(\d{11})\b/];
  for (const p of patrones) { const m = concepto.match(p); if (m) return m[1]; }
  return null;
}

// Extrae el DNI de un CUIT argentino
// Estructura: [20|23|24|27] + [8 dígitos DNI] + [verificador]
// Ej: 20123456780 → DNI 12345678
function extraerDniDeCuit(cuit) {
  if (!cuit || cuit.length !== 11) return null;
  const prefijos = ['20', '23', '24', '27'];
  const prefijo = cuit.slice(0, 2);
  if (!prefijos.includes(prefijo)) return null;
  const dni = cuit.slice(2, 10); // 8 dígitos del medio
  // Quitar ceros a la izquierda por si acaso (DNIs menores a 10.000.000)
  return String(parseInt(dni));
}

// Parsea importes argentinos: "48.000,00" → 48000, "48000.00" → 48000
function parsearImporteExtracto(s) {
  s = s.trim();
  if (!s) return NaN;
  // Formato argentino: punto como miles, coma como decimal → "48.000,00"
  if (s.includes(',') && s.includes('.')) {
    return parseFloat(s.replace(/\./g, '').replace(',', '.'));
  }
  // Solo coma como decimal → "48000,00"
  if (s.includes(',')) {
    return parseFloat(s.replace(',', '.'));
  }
  // Formato estándar o ya numérico
  return parseFloat(s.replace(/[^\d.-]/g, ''));
}

// Parsea fechas de extractos: acepta DD-MM-YYYY (MP), DD/MM/YYYY (bancos), ISO
function parsearFechaExtracto(s) {
  if (!s || !s.trim()) return new Date().toISOString().slice(0, 10);
  s = s.trim();
  // DD-MM-YYYY (Mercado Pago: "01-05-2026")
  const mDash = s.match(/^(\d{1,2})-(\d{1,2})-(\d{4})$/);
  if (mDash) {
    const [, d, m, y] = mDash;
    return `${y}-${m.padStart(2,'0')}-${d.padStart(2,'0')}`;
  }
  // DD/MM/YYYY o D/M/YYYY
  const mSlash = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (mSlash) {
    const [, d, m, y] = mSlash;
    return `${y}-${m.padStart(2,'0')}-${d.padStart(2,'0')}`;
  }
  // ISO o lo que venga
  return s.slice(0, 10);
}

app.post('/api/cobranza/procesar-extracto', upload.single('extracto'), (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No se recibio archivo' });
    const { mes, ano } = req.body;
    if (!mes || !ano) return res.status(400).json({ error: 'Indica mes y ano' });

    const wb = XLSX.read(req.file.buffer, { type: 'buffer' });
    const ws = wb.Sheets[wb.SheetNames[0]];
    const filas = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });

    // Detectar columnas del extracto — acepta formatos bancarios argentinos y Mercado Pago
    let iFecha = -1, iConcepto = -1, iImporte = -1, iCredito = -1;
    let headerRowExtracto = -1;
    let esMercadoPago = false;
    for (let r = 0; r < Math.min(filas.length, 15); r++) {
      const row = filas[r].map(c => String(c).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim());

      // ── Formato Mercado Pago ──────────────────────────────────────────────────
      // Encabezados: RELEASE_DATE | TRANSACTION_TYPE | REFERENCE_ID | TRANSACTION_NET_AMOUNT | PARTIAL_BALANCE
      // El nombre del pagador viene en TRANSACTION_TYPE: "Transferencia recibida Juan Perez"
      if (row.some(c => c === 'release_date') && row.some(c => c === 'transaction_net_amount')) {
        headerRowExtracto = r;
        esMercadoPago = true;
        iFecha    = row.findIndex(c => c === 'release_date');
        iConcepto = row.findIndex(c => c === 'transaction_type');
        iImporte  = row.findIndex(c => c === 'transaction_net_amount');
        break;
      }

      // ── Formato bancario estándar (Cuenta DNI, Banco Galicia, etc.) ───────────
      const tieneFecha   = row.some(c => c.includes('fecha'));
      const tieneImporte = row.some(c => c.includes('importe') || c.includes('credito') || c.includes('haber') || c.includes('monto') || c === 'entrada' || c === 'ingreso');
      if (tieneFecha && tieneImporte) {
        headerRowExtracto = r;
        iFecha    = row.findIndex(c => c.includes('fecha'));
        iConcepto = row.findIndex(c =>
          c.includes('concepto') || c.includes('descripcion') || c.includes('detalle') ||
          c.includes('referencia') || c.includes('movimiento') || c.includes('comprobante')
        );
        iImporte  = row.findIndex(c => c.includes('importe'));
        iCredito  = row.findIndex(c =>
          c.includes('credito') || c.includes('haber') || c.includes('monto') ||
          c === 'entrada' || c === 'ingreso'
        );
        if (iImporte === -1) iImporte = iCredito;
        break;
      }
    }
    if (iImporte === -1) {
      // Loguear las primeras filas para debug
      const preview = filas.slice(0, 5).map(r => r.join(' | ')).join('\n');
      console.error('Extracto no reconocido. Primeras filas:\n' + preview);
      return res.status(400).json({ error: 'No se reconocio el formato del extracto. Columnas encontradas: ' + (filas[0] || []).join(', ') });
    }

    // Cargar todos los alumnos (con CUIT o con DNI)
    const alumnos = db.prepare('SELECT id, nombre, dni, cuit, cuota_mensual FROM alumnos').all();

    // Construir mapas de búsqueda: por CUIT completo y por DNI
    const mapaCuit = {};  // cuit_11_digitos → alumno
    const mapaDni  = {};  // dni_sin_ceros  → alumno

    alumnos.forEach(a => {
      if (a.cuit) {
        const cuitLimpio = a.cuit.replace(/\D/g, '');
        if (cuitLimpio.length === 11) mapaCuit[cuitLimpio] = a;
      }
      if (a.dni) {
        const dniLimpio = String(parseInt(a.dni.replace(/\D/g, '') || '0'));
        if (dniLimpio !== '0') mapaDni[dniLimpio] = a;
      }
      // Pagadores alternativos (padre, familiar, etc.)
      if (a.cuits_alternativos) {
        try {
          const alternos = JSON.parse(a.cuits_alternativos);
          alternos.forEach(val => {
            const limpio = val.replace(/\D/g, '');
            if (limpio.length === 11) mapaCuit[limpio] = a;
            else if (limpio.length >= 7 && limpio.length <= 8) {
              mapaDni[String(parseInt(limpio))] = a;
            }
          });
        } catch(e) {}
      }
    });

    const tieneDatos = Object.keys(mapaCuit).length > 0 || Object.keys(mapaDni).length > 0;
    if (!tieneDatos) return res.json({
      procesados: 0,
      mensaje: 'Ningun alumno tiene DNI ni CUIT cargado. Edita los perfiles primero.'
    });

    const resultados = [];
    const noIdentificados = []; // movimientos sin match → revisar manualmente

    for (let r = headerRowExtracto + 1; r < filas.length; r++) {
      const fila = filas[r];
      const importeRaw = fila[iImporte];
      // Parseo de importe: soporta formato argentino (48.000,00) y estándar
      const importe = typeof importeRaw === 'number'
        ? importeRaw
        : parsearImporteExtracto(String(importeRaw));
      if (isNaN(importe) || importe <= 0) continue; // solo cobros (positivos)

      const concepto = String(fila[iConcepto] || '');
      const fechaRaw = String(fila[iFecha] || '');
      // Parseo de fecha: soporta DD-MM-YYYY (Mercado Pago) y DD/MM/YYYY (bancos)
      const fecha = parsearFechaExtracto(fechaRaw);
      const cuit  = esMercadoPago ? null : extraerCuit(concepto);

      let alumno = null;
      let metodoMatch = '';

      // 1. Intentar por CUIT completo
      if (cuit && mapaCuit[cuit]) {
        alumno = mapaCuit[cuit];
        metodoMatch = 'cuit';
      }

      // 2. Si no, extraer DNI del CUIT y buscar por DNI
      if (!alumno && cuit) {
        const dniDelCuit = extraerDniDeCuit(cuit);
        if (dniDelCuit && mapaDni[dniDelCuit]) {
          alumno = mapaDni[dniDelCuit];
          metodoMatch = 'dni_de_cuit';
        }
      }

      // 3. Fallback: buscar por nombre en la descripción (ej: Mercado Pago)
      if (!alumno && concepto) {
        const todosAlumnos = db.prepare('SELECT id, nombre FROM alumnos').all();
        const match = todosAlumnos.find(a => coincideNombre(a.nombre, concepto));
        if (match) {
          alumno = match;
          metodoMatch = 'nombre';
        }
      }

      if (!alumno) {
        if (concepto.trim()) {
          noIdentificados.push({ cuit: cuit || null, concepto, importe, fecha });
        }
        continue;
      }
      const existente = db.prepare('SELECT id FROM pagos WHERE alumno_id=? AND mes=? AND ano=?').get(alumno.id, mes, ano);
      if (!existente) {
        db.prepare('INSERT INTO pagos (alumno_id, mes, ano, monto, fecha_pago, metodo, verificado) VALUES (?,?,?,?,?,?,1)')
          .run(alumno.id, mes, ano, importe, fecha || new Date().toISOString().slice(0,10), esMercadoPago ? 'mercadopago' : 'transferencia');
      }
      resultados.push({ alumno_id: alumno.id, nombre: alumno.nombre, importe, metodo: metodoMatch, ya_registrado: !!existente });
    }
    res.json({
      procesados: resultados.length, resultados, no_identificados: noIdentificados,
      mensaje: 'Se identificaron ' + resultados.length + ' pagos.' + (noIdentificados.length > 0 ? ' ' + noIdentificados.length + ' sin identificar.' : '')
    });
  } catch (e) {
    console.error('Error procesando extracto:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// ── API: Importar pagos en efectivo desde Excel casero ────────────────────────
// Formato esperado: columnas Nombre (o Alumno), Monto (o Importe), Fecha (opcional)
app.post('/api/cobranza/importar-efectivo', upload.single('archivo'), (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No se recibio archivo' });
    const mes = parseInt(req.body.mes);
    const ano = parseInt(req.body.ano || req.body.año);
    if (!mes || !ano) return res.status(400).json({ error: 'Indica mes y ano' });

    const wb = XLSX.read(req.file.buffer, { type: 'buffer' });
    const ws = wb.Sheets[wb.SheetNames[0]];
    const filas = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });

    // Detectar fila de encabezado
    let headerIdx = -1, iNombre = -1, iMonto = -1, iFecha = -1;
    for (let r = 0; r < Math.min(filas.length, 10); r++) {
      const row = filas[r].map(c => String(c).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim());
      const tieneNombre = row.some(c => c.includes('nombre') || c.includes('alumno'));
      const tieneMonto  = row.some(c => c.includes('monto') || c.includes('importe') || c.includes('cuota'));
      if (tieneNombre && tieneMonto) {
        headerIdx = r;
        iNombre = row.findIndex(c => c.includes('nombre') || c.includes('alumno'));
        iMonto  = row.findIndex(c => c.includes('monto') || c.includes('importe') || c.includes('cuota'));
        iFecha  = row.findIndex(c => c.includes('fecha'));
        break;
      }
    }
    if (iNombre === -1 || iMonto === -1) {
      return res.status(400).json({
        error: 'No se reconocio el formato. El Excel debe tener columnas "Nombre" y "Monto" (o "Importe").'
      });
    }

    // Cargar todos los alumnos para matching por nombre
    const alumnos = db.prepare('SELECT id, nombre FROM alumnos').all();

    const registrados = [], noEncontrados = [], yaRegistrados = [];
    const hoyISO = new Date().toISOString().slice(0, 10);

    for (let r = headerIdx + 1; r < filas.length; r++) {
      const fila = filas[r];
      const nombreRaw = String(fila[iNombre] || '').trim();
      if (!nombreRaw) continue;

      const montoRaw = fila[iMonto];
      const monto = typeof montoRaw === 'number' ? montoRaw : parseFloat(String(montoRaw).replace(/[^\d.-]/g, ''));
      if (isNaN(monto) || monto <= 0) continue;

      const fechaRaw = iFecha !== -1 ? fila[iFecha] : null;
      const fecha = parsearFecha(fechaRaw) || hoyISO;

      // Buscar alumno por nombre — coincidencia parcial, ignora mayúsculas/tildes
      const normalizar = s => s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
      const nombreNorm = normalizar(nombreRaw);
      const alumno = alumnos.find(a => {
        const n = normalizar(a.nombre);
        return n === nombreNorm || n.includes(nombreNorm) || nombreNorm.includes(n);
      });

      if (!alumno) {
        noEncontrados.push({ nombre: nombreRaw, monto });
        continue;
      }

      const existente = db.prepare('SELECT id FROM pagos WHERE alumno_id=? AND mes=? AND ano=?').get(alumno.id, mes, ano);
      if (existente) {
        yaRegistrados.push({ nombre: alumno.nombre, monto });
        continue;
      }

      db.prepare('INSERT INTO pagos (alumno_id, mes, ano, monto, fecha_pago, metodo, verificado) VALUES (?,?,?,?,?,?,1)')
        .run(alumno.id, mes, ano, monto, fecha, 'efectivo');
      registrados.push({ nombre: alumno.nombre, monto, fecha });
    }

    const partes = [];
    if (registrados.length > 0) partes.push(`${registrados.length} pago${registrados.length > 1 ? 's' : ''} registrado${registrados.length > 1 ? 's' : ''}`);
    if (yaRegistrados.length > 0) partes.push(`${yaRegistrados.length} ya estaban registrados`);
    if (noEncontrados.length > 0) partes.push(`${noEncontrados.length} nombre${noEncontrados.length > 1 ? 's' : ''} sin coincidencia`);

    res.json({
      registrados: registrados.length,
      ya_registrados: yaRegistrados,
      no_encontrados: noEncontrados,
      mensaje: partes.join(', ') + '.'
    });
  } catch (e) {
    console.error('Error importando efectivo:', e.message);
    res.status(500).json({ error: e.message });
  }
});


app.listen(3000, () => {
  console.log('App corriendo en http://localhost:3000');
  console.log('Para activar el escaner de IA, crea un archivo .env con ANTHROPIC_API_KEY=sk-ant-...');
});
