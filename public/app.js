/* ════════════════════════════════════════════════════════════════════════════
   App de Gestión de Rutinas de Gimnasio
   Vanilla JS — SPA sin framework
   ════════════════════════════════════════════════════════════════════════════ */

// ── Estado global ─────────────────────────────────────────────────────────────
const state = {
  alumnos: [],
  alumnoActual: null,
  cicloActual: null,
  planActivo: 'A',
  tabActiva: 'rutina',
  filtro: 'todos',
  soloActivos: true,
  busqueda: '',
  propuesta: null,
  formNuevoAlumno: { paso: 1, datos: {}, planesData: { A: { ec: '', circuitos: [] }, B: { ec: '', circuitos: [] } } },
  scanData: null
};

// ── Router ────────────────────────────────────────────────────────────────────
const routes = {
  panel:        renderPanel,
  perfil:       renderPerfil,
  scanner:      renderScanner,
  nuevoManual:  renderNuevoManual,
  propuesta:    renderPropuesta,
  confirmacion: renderConfirmacion,
  cobranza:     renderCobranza,
  configuracion: renderConfiguracion
};

let routeActual = 'panel';
let routeParams = {};

function navigate(ruta, params = {}) {
  routeActual = ruta;
  routeParams = params;
  renderApp();
  window.scrollTo(0, 0);
}

function renderApp() {
  const app = document.getElementById('app');
  app.innerHTML = '';
  const fn = routes[routeActual];
  if (fn) fn(app, routeParams);
}

// ── Utilidades ────────────────────────────────────────────────────────────────
function iniciales(nombre) {
  return nombre.split(' ').slice(0, 2).map(w => w[0]).join('').toUpperCase();
}

function colorAvatar(estado) {
  if (estado === 'ciclo_activo')   return 'green';
  if (estado === 'ciclo_completo') return 'amber';
  return 'gray';
}

function formatFecha(txt) {
  if (!txt) return '—';
  const d = new Date(txt + 'T00:00:00');
  return d.toLocaleDateString('es-AR', { day: 'numeric', month: 'short', year: 'numeric' });
}

function toast(msg, tipo = '') {
  const el = document.createElement('div');
  el.className = `toast ${tipo}`;
  el.textContent = msg;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 3000);
}

// ── API ───────────────────────────────────────────────────────────────────────
async function api(method, endpoint, body) {
  const opts = { method, headers: { 'Content-Type': 'application/json' } };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch('/api' + endpoint, opts);
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Error del servidor');
  return data;
}

// ── Pantalla 1: Panel de alumnos ──────────────────────────────────────────────
async function renderPanel(container) {
  container.innerHTML = `
    <div class="screen active" id="screen-panel">
      <div class="header">
        <img src="logo.png" class="header-logo" alt="Voltage" onerror="this.style.display='none';this.nextElementSibling.style.display='block'">
        <span class="header-logo-text" style="display:none">VOLTAGE</span>
        <div class="header-title" style="color:#fff">Mis alumnos</div>
        <div class="header-actions">
          <button class="panel-btn" id="btn-importar">📥 Alumnos</button>
          <button class="panel-btn" id="btn-cobranza">💰 Cobros</button>
          <button class="panel-btn" id="btn-scan">📷 Fotos</button>
          <button class="panel-btn accent" id="btn-nuevo-manual">+ Nuevo</button>
        </div>
      </div>
      <div class="content">
        <div id="panel-body">
          <div class="loading-screen" style="height:200px">
            <div class="spinner" style="border-color:rgba(0,0,0,.15);border-top-color:var(--text)"></div>
          </div>
        </div>
      </div>
      <button class="fab" id="btn-fab">+</button>
    </div>`;

  document.getElementById('btn-importar').onclick = () => mostrarModalImportarExcel();
  document.getElementById('btn-cobranza').onclick = () => navigate('cobranza');
  document.getElementById('btn-scan').onclick = () => navigate('scanner');
  document.getElementById('btn-nuevo-manual').onclick = () => navigate('nuevoManual');
  document.getElementById('btn-fab').onclick = () => navigate('nuevoManual');

  try {
    state.alumnos = await api('GET', '/alumnos');
    renderPanelBody();
  } catch (e) {
    document.getElementById('panel-body').innerHTML = `<div class="empty-state"><div class="empty-icon">⚠️</div><p class="empty-text">${e.message}</p></div>`;
  }
}

// Calcula días restantes del ciclo activo según cantidad de planes
// 1 plan: 3 sesiones/semana -> 12 sesiones = 28 días
// 2 planes: 5 sesiones/semana alternadas -> 12 sesiones c/u = 34 días
function diasRestantesCiclo(a) {
  // Funciona para ciclo_activo y ciclo_completo (recientemente terminado)
  if (!a.ciclo?.fecha_inicio) return null;
  if (a.estado !== 'ciclo_activo' && a.estado !== 'ciclo_completo') return null;
  const numPlanes = (a.planes || []).length;
  const duracion = numPlanes >= 2 ? 34 : 28;
  const inicio = new Date(a.ciclo.fecha_inicio);
  const hoy = new Date();
  hoy.setHours(0, 0, 0, 0);
  inicio.setHours(0, 0, 0, 0);
  const transcurridos = Math.floor((hoy - inicio) / 86400000);
  return duracion - transcurridos;
}

function renderPanelBody() {
  const body = document.getElementById('panel-body');
  if (!body) return;

  // Filtro base: solo activos (con DNI) o todos
  const baseAlumnos = state.soloActivos
    ? state.alumnos.filter(a => a.dni && a.dni.trim() !== '')
    : state.alumnos;

  const activos = baseAlumnos.filter(a => a.estado === 'ciclo_activo').length;
  const completos = baseAlumnos.filter(a => a.estado === 'ciclo_completo').length;
  const proximos = baseAlumnos.filter(a => {
    const d = diasRestantesCiclo(a);
    return d !== null && d <= 5 && d >= -10;
  }).length;

  let filtrados = baseAlumnos;
  if (state.filtro === 'activo')   filtrados = baseAlumnos.filter(a => a.estado === 'ciclo_activo');
  if (state.filtro === 'completo') filtrados = baseAlumnos.filter(a => a.estado === 'ciclo_completo');
  if (state.filtro === 'sin_ciclo') filtrados = baseAlumnos.filter(a => a.estado === 'sin_ciclo');
  if (state.filtro === 'proximos') filtrados = baseAlumnos.filter(a => {
    const d = diasRestantesCiclo(a);
    return d !== null && d <= 5 && d >= -10;
  });
  if (state.filtro === 'pago')     filtrados = baseAlumnos.filter(a => a.pago_mes_actual);
  if (state.filtro === 'sin_pago') filtrados = baseAlumnos.filter(a => !a.pago_mes_actual);

  // Aplicar búsqueda por nombre
  if (state.busqueda.trim()) {
    const q = state.busqueda.trim().toLowerCase();
    filtrados = filtrados.filter(a => a.nombre.toLowerCase().includes(q));
  }

  body.innerHTML = `
    <div class="metrics-grid metrics-grid-4">
      <div class="metric-card"><div class="num">${baseAlumnos.length}</div><div class="lbl">${state.soloActivos ? 'Activos' : 'Total'}</div></div>
      <div class="metric-card"><div class="num">${activos}</div><div class="lbl">Ciclo activo</div></div>
      <div class="metric-card"><div class="num" style="color:var(--amber)">${completos}</div><div class="lbl">Completaron</div></div>
      <div class="metric-card metric-card-warning ${proximos > 0 ? 'has-alert' : ''}">
        <div class="num" style="color:var(--alert)">${proximos}</div>
        <div class="lbl">Proximos a terminar</div>
      </div>
    </div>

    <div class="panel-search">
      <input class="form-input" id="input-busqueda" type="text"
        placeholder="🔍  Buscar alumno por nombre..."
        value="${state.busqueda}"
        style="margin:0;border-radius:10px">
    </div>

    <div class="filters">
      <button class="filter-pill ${state.filtro === 'todos' ? 'active' : ''}" data-f="todos">Todos</button>
      <button class="filter-pill ${state.filtro === 'activo' ? 'active' : ''}" data-f="activo">Con ciclo</button>
      <button class="filter-pill ${state.filtro === 'completo' ? 'active' : ''}" data-f="completo">Terminaron</button>
      <button class="filter-pill ${state.filtro === 'sin_ciclo' ? 'active' : ''}" data-f="sin_ciclo">Sin ciclo</button>
      <button class="filter-pill filter-pill-alert ${state.filtro === 'proximos' ? 'active' : ''}" data-f="proximos">⏰ Por terminar ${proximos > 0 ? `<span class="pill-badge">${proximos}</span>` : ''}</button>
      <button class="filter-pill ${state.filtro === 'pago' ? 'active' : ''}" data-f="pago" style="border-color:var(--green);color:var(--green)">✓ Pagaron</button>
      <button class="filter-pill ${state.filtro === 'sin_pago' ? 'active' : ''}" data-f="sin_pago" style="border-color:var(--amber);color:var(--amber)">⚠ Sin pago</button>
      <button class="filter-pill filter-pill-activos ${state.soloActivos ? 'active' : ''}" id="btn-toggle-activos">
        ${state.soloActivos ? '👤 Activos' : '👥 Todos'}
      </button>
    </div>

    <div class="alumnos-list">
      ${filtrados.length === 0 ? `<div class="empty-state"><div class="empty-icon">🏋️</div><p class="empty-text">No hay alumnos en esta categoría</p></div>` : ''}
      ${filtrados.map(a => alumnoCardHTML(a)).join('')}
    </div>`;

  // Filtros
  body.querySelectorAll('.filter-pill[data-f]').forEach(btn => {
    btn.onclick = () => { state.filtro = btn.dataset.f; renderPanelBody(); };
  });
  const btnToggleActivos = document.getElementById('btn-toggle-activos');
  if (btnToggleActivos) {
    btnToggleActivos.onclick = () => { state.soloActivos = !state.soloActivos; renderPanelBody(); };
  }
  const inputBusqueda = document.getElementById('input-busqueda');
  if (inputBusqueda) {
    inputBusqueda.oninput = (e) => { state.busqueda = e.target.value; renderPanelBody(); };
    // Mantener foco y cursor al final después de re-render
    inputBusqueda.focus();
    inputBusqueda.setSelectionRange(inputBusqueda.value.length, inputBusqueda.value.length);
  }

  // Tarjetas alumno
  body.querySelectorAll('.alumno-card').forEach(card => {
    card.onclick = () => navigate('perfil', { id: parseInt(card.dataset.id) });
  });
}

function alumnoCardHTML(a) {
  const color = colorAvatar(a.estado);
  const cicloLabel = a.ciclo ? `Ciclo ${a.ciclo.numero_ciclo}` : 'Sin ciclo';
  const planBadges = (a.planes || []).map(p => `<span class="plan-badge">Plan ${p}</span>`).join('');

  // Badge de días restantes
  const dias = diasRestantesCiclo(a);
  let diasBadge = '';
  if (dias !== null && dias <= 7) {
    if (dias < 0) {
      diasBadge = `<span class="dias-badge dias-vencido">Vencido</span>`;
    } else if (dias === 0) {
      diasBadge = `<span class="dias-badge dias-hoy">Hoy</span>`;
    } else {
      diasBadge = `<span class="dias-badge dias-pronto">${dias}d</span>`;
    }
  }

  return `
    <div class="alumno-card" data-id="${a.id}">
      <div class="avatar-sm ${color}">${iniciales(a.nombre)}</div>
      <div class="alumno-info">
        <div class="alumno-name">
          <span class="status-dot ${color}"></span>
          ${a.nombre}
        </div>
        <div class="alumno-meta-row">
          <span class="alumno-meta">${cicloLabel}</span>
          ${planBadges}
          ${diasBadge}
        </div>
      </div>
      <svg class="card-arrow" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 18l6-6-6-6"/></svg>
    </div>`;
}

// ── Pantalla 2: Perfil del alumno ─────────────────────────────────────────────
async function renderPerfil(container, { id }) {
  container.innerHTML = `
    <div class="screen active" id="screen-perfil">
      <div class="header">
        <button class="back-btn" id="btn-back">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M15 18l-6-6 6-6"/></svg>
          Atrás
        </button>
        <div class="header-title" id="perfil-titulo">Perfil</div>
        <div class="header-actions">
          <button class="icon-btn" id="btn-editar" title="Editar alumno">✏️</button>
          <button class="icon-btn icon-btn-danger" id="btn-eliminar" title="Eliminar alumno">🗑️</button>
        </div>
      </div>
      <div class="content" id="perfil-body">
        <div class="loading-screen" style="height:300px">
          <div class="spinner" style="border-color:rgba(0,0,0,.15);border-top-color:var(--text)"></div>
        </div>
      </div>
    </div>`;

  document.getElementById('btn-back').onclick = () => navigate('panel');

  try {
    const [alumno, cicloData] = await Promise.all([
      api('GET', `/alumnos/${id}`),
      api('GET', `/alumnos/${id}/ciclo-activo`)
    ]);
    state.alumnoActual = alumno;
    state.cicloActual = cicloData;

    // Detectar primer plan disponible
    if (cicloData?.planes?.length > 0) {
      state.planActivo = cicloData.planes[0].tipo;
    }

    document.getElementById('perfil-titulo').textContent = alumno.nombre;
    document.getElementById('btn-editar').onclick = () => mostrarModalEditar(alumno);
    document.getElementById('btn-eliminar').onclick = () => confirmarEliminarAlumno(alumno);

    renderPerfilBody();
  } catch (e) {
    document.getElementById('perfil-body').innerHTML = `<div class="empty-state"><div class="empty-icon">⚠️</div><p class="empty-text">${e.message}</p></div>`;
  }
}

function renderPerfilBody() {
  const a = state.alumnoActual;
  const ciclo = state.cicloActual;
  const body = document.getElementById('perfil-body');
  if (!body || !a) return;

  const color = colorAvatar(a.estado);
  const pct = ciclo?.progreso?.porcentaje ?? 0;

  const tiensPlanes = ciclo?.planes?.length > 0;
  const tienePlanB = tiensPlanes && ciclo.planes.some(p => p.tipo === 'B');
  const estaCompleto = pct === 100;

  body.innerHTML = `
    <div class="alumno-hero">
      <div class="alumno-hero-top">
        <div class="hero-avatar ${color}">${iniciales(a.nombre)}</div>
        <div class="hero-info">
          <h2>${a.nombre}</h2>
          <p>${a.nivel} · ${a.dias_por_semana} días/semana</p>
        </div>
      </div>
      <div class="info-grid">
        <div class="info-item"><div class="label">Objetivo</div><div class="value">${a.objetivo || '—'}</div></div>
        <div class="info-item"><div class="label">Limitaciones</div><div class="value">${a.limitaciones || 'Ninguna'}</div></div>
        ${a.dni ? `<div class="info-item"><div class="label">DNI</div><div class="value">${a.dni}</div></div>` : ''}
        ${a.fecha_inicio ? `<div class="info-item"><div class="label">Fecha inicio</div><div class="value">${formatFecha(a.fecha_inicio)}</div></div>` : ''}
        ${a.edad ? `<div class="info-item"><div class="label">Edad</div><div class="value">${a.edad} años</div></div>` : ''}
        ${a.peso ? `<div class="info-item"><div class="label">Peso</div><div class="value">${a.peso} kg</div></div>` : ''}
        ${a.altura ? `<div class="info-item"><div class="label">Altura</div><div class="value">${a.altura} cm</div></div>` : ''}
        ${a.cuit ? `<div class="info-item"><div class="label">CUIT/CUIL</div><div class="value">${a.cuit}</div></div>` : ''}
        ${a.cuota_mensual ? `<div class="info-item"><div class="label">Cuota mensual</div><div class="value">$${Number(a.cuota_mensual).toLocaleString('es-AR')}</div></div>` : ''}
      </div>
    </div>

    ${ciclo ? `
    <div class="ciclo-progress-card">
      <div class="ciclo-progress-header">
        <span class="ciclo-progress-title">Ciclo ${ciclo.numero_ciclo}</span>
        <span class="ciclo-progress-pct ${pct === 100 ? 'amber' : 'green'}">${pct}%</span>
      </div>
      <div class="ciclo-progress-bar-wrap">
        <div class="ciclo-progress-fill ${pct === 100 ? 'amber' : ''}" style="width:${pct}%"></div>
      </div>
      <div class="ciclo-meta">Inicio: ${formatFecha(ciclo.fecha_inicio)} · ${ciclo.progreso.completadas}/${ciclo.progreso.total} visitas</div>
    </div>` : `
    <div class="ciclo-progress-card">
      <p style="color:var(--text3);font-size:14px;text-align:center;padding:8px 0">Sin ciclo activo</p>
      <button class="btn-primary" id="btn-crear-ciclo" style="margin-top:10px">Crear primer ciclo</button>
    </div>`}

    <div class="tabs">
      <button class="tab-btn ${state.tabActiva === 'rutina' ? 'active' : ''}" data-tab="rutina">Rutina actual</button>
      <button class="tab-btn ${state.tabActiva === 'historial' ? 'active' : ''}" data-tab="historial">Historial</button>
    </div>

    <div id="tab-content"></div>

    ${ciclo ? `
    <button class="generar-ciclo-btn ${estaCompleto ? '' : 'generar-anticipado'}" id="btn-generar">
      🔄 Generar ciclo ${ciclo.numero_ciclo + 1}${estaCompleto ? '' : ' (anticipado)'}
    </button>` : ''}
  `;

  // Tabs
  body.querySelectorAll('.tab-btn').forEach(btn => {
    btn.onclick = () => {
      state.tabActiva = btn.dataset.tab;
      body.querySelectorAll('.tab-btn').forEach(b => b.classList.toggle('active', b.dataset.tab === state.tabActiva));
      renderTabContent();
    };
  });

  // Crear ciclo
  const btnCrear = document.getElementById('btn-crear-ciclo');
  if (btnCrear) btnCrear.onclick = () => navigate('nuevoManual', { alumnoId: a.id });

  // Generar ciclo
  const btnGen = document.getElementById('btn-generar');
  if (btnGen) btnGen.onclick = () => generarCicloNuevo();

  renderTabContent();
}

async function generarCicloNuevo() {
  const btn = document.getElementById('btn-generar');
  if (btn) { btn.disabled = true; btn.innerHTML = '<span class="spinner"></span> Analizando...'; }
  try {
    const propuesta = await api('POST', `/generar-ciclo/${state.alumnoActual.id}`);
    state.propuesta = propuesta;
    navigate('propuesta', { alumnoId: state.alumnoActual.id });
  } catch (e) {
    toast(e.message, 'error');
    if (btn) { btn.disabled = false; btn.innerHTML = '🔄 Generar ciclo nuevo'; }
  }
}

function renderTabContent() {
  const tc = document.getElementById('tab-content');
  if (!tc) return;
  if (state.tabActiva === 'rutina') renderTabRutina(tc);
  else renderTabHistorial(tc);
}

function renderTabRutina(container) {
  const ciclo = state.cicloActual;
  if (!ciclo || !ciclo.planes || ciclo.planes.length === 0) {
    container.innerHTML = `<div class="empty-state"><div class="empty-icon">📋</div><p class="empty-text">No hay rutina cargada</p></div>`;
    return;
  }

  const tieneB = ciclo.planes.some(p => p.tipo === 'B');
  const planData = ciclo.planes.find(p => p.tipo === state.planActivo) || ciclo.planes[0];

  container.innerHTML = `
    ${tieneB ? `
    <div class="plan-selector">
      ${ciclo.planes.map(p => `
        <button class="plan-selector-btn ${state.planActivo === p.tipo ? 'active' : ''}" data-plan="${p.tipo}">
          Plan ${p.tipo}
        </button>`).join('')}
    </div>` : ''}

    ${planData.entrada_en_calor ? `
    <div class="ec-card">
      <div class="ec-label">⚡ Entrada en calor</div>
      <div class="ec-text">${planData.entrada_en_calor}</div>
    </div>` : ''}

    ${planData.circuitos?.map((circ, i) => renderCircuitoHTML(circ, ciclo.id, i + 1)).join('') || ''}
  `;

  // Selector plan A/B
  container.querySelectorAll('.plan-selector-btn').forEach(btn => {
    btn.onclick = () => {
      state.planActivo = btn.dataset.plan;
      container.querySelectorAll('.plan-selector-btn').forEach(b => b.classList.toggle('active', b.dataset.plan === state.planActivo));
      renderTabRutina(container);
    };
  });

  // Botones guardar resultado final
  container.querySelectorAll('.resultado-guardar').forEach(btn => {
    btn.onclick = async () => {
      const ejId = btn.dataset.ejId;
      const pesoFin = document.getElementById('peso-fin-' + ejId)?.value.trim();
      const repsFin = document.getElementById('reps-fin-' + ejId)?.value.trim();
      btn.disabled = true; btn.textContent = '...';
      try {
        await api('PUT', '/ejercicios/' + ejId + '/resultado', { peso_fin: pesoFin, reps_fin: repsFin });
        btn.textContent = '✓';
        btn.classList.add('guardado');
        toast('Resultado guardado', 'success');
        // Refrescar datos del ciclo
        state.cicloActual = await api('GET', '/alumnos/' + state.alumnoActual.id + '/ciclo-activo');
      } catch(e) {
        toast(e.message, 'error');
        btn.disabled = false; btn.textContent = 'Guardar';
      }
    };
  });
}

function renderCircuitoHTML(circ, cicloId, idx) {
  const { principal, complemento } = circ;
  if (!principal) return '';

  const tieneResultado = principal.peso_fin || principal.reps_fin;

  return `
    <div class="circuito-card" data-circ-id="${circ.id || ''}">
      <div class="circuito-header">
        <span class="circuito-title">Circuito ${idx}</span>
        <span class="circuito-series">${circ.series} series</span>
      </div>
      <div class="circuito-body">

        <div class="ejercicio-principal">
          <div class="ejercicio-nombre">${principal.nombre}</div>

          ${principal.notas ? `
          <div class="resultado-bloque">
            <div class="resultado-label">Inicio</div>
            <div class="ejercicio-notas">${principal.notas}</div>
          </div>` : ''}

          <div class="resultado-bloque">
            <div class="resultado-label">Resultado final</div>
            <div class="resultado-inputs">
              <div class="resultado-field">
                <label class="resultado-sublabel">Peso (kg)</label>
                <input type="text" class="resultado-input" id="peso-fin-${principal.id}"
                  value="${principal.peso_fin || ''}" placeholder="ej: 65">
              </div>
              <div class="resultado-field">
                <label class="resultado-sublabel">Reps</label>
                <input type="text" class="resultado-input" id="reps-fin-${principal.id}"
                  value="${principal.reps_fin || ''}" placeholder="ej: 10">
              </div>
              <button class="resultado-guardar ${tieneResultado ? 'guardado' : ''}"
                data-ej-id="${principal.id}"
                title="${tieneResultado ? 'Guardado' : 'Guardar'}">
                ${tieneResultado ? '✓' : 'Guardar'}
              </button>
            </div>
          </div>
        </div>

        ${complemento ? `
        <div class="ejercicio-complemento">
          <span class="complemento-tag">COMP</span>
          <div class="complemento-info">
            <div class="complemento-nombre">${complemento.nombre}</div>
            ${complemento.notas ? `<div class="complemento-notas">${complemento.notas}</div>` : ''}
          </div>
        </div>` : ''}

      </div>
    </div>`;
}

async function renderTabHistorial(container) {
  try {
    const ciclos = await api('GET', `/alumnos/${state.alumnoActual.id}/ciclos`);
    if (ciclos.length === 0) {
      container.innerHTML = `<div class="empty-state"><div class="empty-icon">📅</div><p class="empty-text">Sin historial de ciclos</p></div>`;
      return;
    }
    container.innerHTML = `
      <div class="historial-list">
        ${ciclos.map(c => `
          <div class="historial-item">
            <div>
              <div class="historial-ciclo">Ciclo ${c.numero_ciclo}</div>
              <div class="historial-fechas">${formatFecha(c.fecha_inicio)}${c.fecha_fin ? ' → ' + formatFecha(c.fecha_fin) : ''}</div>
            </div>
            <span class="historial-badge ${c.estado}">${c.estado === 'activo' ? 'Activo' : 'Cerrado'}</span>
          </div>`).join('')}
      </div>`;
  } catch (e) {
    container.innerHTML = `<div class="empty-state"><p class="empty-text">${e.message}</p></div>`;
  }
}

// ── Modal: registrar visita ────────────────────────────────────────────────────
function mostrarModalVisita(ejId, cicloId, num, visitaId, pesosActuales, repsActuales, ejNombre) {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal">
      <div class="modal-drag"></div>
      <div class="modal-title">Visita ${num}</div>
      <div class="modal-sub">${ejNombre}</div>
      <div class="form-group">
        <label class="form-label">Repeticiones</label>
        <input type="number" class="form-input" id="m-reps" value="${repsActuales || ''}" placeholder="ej: 6" min="1" max="30">
      </div>
      <div class="form-group">
        <label class="form-label">Pesos por serie (separados por coma)</label>
        <input type="text" class="form-input" id="m-pesos" value="${pesosActuales || ''}" placeholder="ej: 10,10,12,12">
      </div>
      <button class="btn-primary" id="m-guardar">Guardar visita</button>
      <button class="btn-secondary" id="m-cancelar">Cancelar</button>
    </div>`;

  document.body.appendChild(overlay);
  overlay.querySelector('#m-cancelar').onclick = () => overlay.remove();
  overlay.onclick = (e) => { if (e.target === overlay) overlay.remove(); };
  overlay.querySelector('#m-reps').focus();

  overlay.querySelector('#m-guardar').onclick = async () => {
    const reps = parseInt(overlay.querySelector('#m-reps').value);
    const pesos = overlay.querySelector('#m-pesos').value.trim();
    if (!reps) { toast('Ingresá las repeticiones', 'error'); return; }
    const btn = overlay.querySelector('#m-guardar');
    btn.disabled = true; btn.innerHTML = '<span class="spinner"></span> Guardando...';
    try {
      if (visitaId) {
        await api('PUT', `/registros/${visitaId}`, { reps, pesos_por_serie: pesos });
      } else {
        await api('POST', '/registros', { ejercicio_id: ejId, ciclo_id: cicloId, numero_visita: num, reps, pesos_por_serie: pesos });
      }
      overlay.remove();
      toast('¡Visita guardada!', 'success');
      // Recargar ciclo
      const cicloData = await api('GET', `/alumnos/${state.alumnoActual.id}/ciclo-activo`);
      state.cicloActual = cicloData;
      const alumno = await api('GET', `/alumnos/${state.alumnoActual.id}`);
      state.alumnoActual = alumno;
      renderPerfilBody();
    } catch (e) {
      toast(e.message, 'error');
      btn.disabled = false; btn.innerHTML = 'Guardar visita';
    }
  };
}

// ── Eliminar alumno ───────────────────────────────────────────────────────────
function confirmarEliminarAlumno(alumno) {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal" style="max-width:320px;text-align:center">
      <div style="font-size:32px;margin-bottom:12px">⚠️</div>
      <h3 style="margin-bottom:8px">Eliminar alumno</h3>
      <p style="color:var(--text2);font-size:14px;margin-bottom:20px">
        ¿Seguro que querés eliminar a <strong>${alumno.nombre}</strong>?<br>
        <span style="color:var(--red);font-size:13px">Se borran sus rutinas, ciclos y pagos. Esta acción no se puede deshacer.</span>
      </p>
      <div style="display:flex;gap:10px">
        <button class="btn-secondary" id="btn-cancelar-elim" style="flex:1">Cancelar</button>
        <button class="btn-danger" id="btn-confirmar-elim" style="flex:1">Eliminar</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);

  overlay.querySelector('#btn-cancelar-elim').onclick = () => overlay.remove();
  overlay.querySelector('#btn-confirmar-elim').onclick = async () => {
    try {
      await api('DELETE', `/alumnos/${alumno.id}`);
      overlay.remove();
      state.alumnos = state.alumnos.filter(a => a.id !== alumno.id);
      toast(`${alumno.nombre} eliminado`);
      navigate('panel');
    } catch (e) {
      toast(e.message, 'error');
    }
  };
}

// ── Modal: editar alumno ──────────────────────────────────────────────────────
async function mostrarModalEditar(alumno) {
  const actividades = await api('GET', '/actividades').catch(() => []);
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal">
      <div class="modal-drag"></div>
      <div class="modal-title">Editar alumno</div>
      <div class="form-group">
        <label class="form-label">Nombre</label>
        <input type="text" class="form-input" id="e-nombre" value="${alumno.nombre}">
      </div>
      <div class="form-group">
        <label class="form-label">Nivel</label>
        <select class="form-select" id="e-nivel">
          ${['Principiante','Intermedio','Avanzado'].map(n => `<option ${alumno.nivel === n ? 'selected' : ''}>${n}</option>`).join('')}
        </select>
      </div>
      <div class="form-group">
        <label class="form-label">Objetivo</label>
        <input type="text" class="form-input" id="e-objetivo" value="${alumno.objetivo || ''}">
      </div>
      <div class="form-row">
        <div class="form-group">
          <label class="form-label">Días por semana</label>
          <input type="number" class="form-input" id="e-dias" value="${alumno.dias_por_semana}" min="1" max="7">
        </div>
        <div class="form-group">
          <label class="form-label">Limitaciones</label>
          <input type="text" class="form-input" id="e-limit" value="${alumno.limitaciones || ''}">
        </div>
      </div>
      <div class="form-row">
        <div class="form-group">
          <label class="form-label">DNI</label>
          <input type="text" class="form-input" id="e-dni" value="${alumno.dni || ''}" placeholder="30123456">
        </div>
        <div class="form-group">
          <label class="form-label">CUIT / CUIL</label>
          <input type="text" class="form-input" id="e-cuit" value="${alumno.cuit || ''}" placeholder="20XXXXXXXX1">
        </div>
      </div>
      <div class="form-row">
        <div class="form-group">
          <label class="form-label">Fecha de inicio</label>
          <input type="text" class="form-input" id="e-fecha-inicio" value="${alumno.fecha_inicio || ''}" placeholder="ej: 15/3/2024">
        </div>
        <div class="form-group">
          <label class="form-label">Actividad</label>
          <select class="form-input" id="e-actividad">
            <option value="">— Sin actividad —</option>
            ${actividades.map(a => `<option value="${a.id}" ${alumno.actividad_id === a.id ? 'selected' : ''}>${a.nombre} ($${Number(a.cuota).toLocaleString('es-AR',{maximumFractionDigits:0})})</option>`).join('')}
          </select>
        </div>
        <div class="form-group">
          <label class="form-label">Cuota mensual ($) <span style="font-size:11px;color:var(--text3)">(se completa con la actividad)</span></label>
          <input type="number" class="form-input" id="e-cuota" value="${alumno.cuota_mensual || ''}" placeholder="ej: 48000">
        </div>
      </div>
      <div class="form-row">
        <div class="form-group">
          <label class="form-label">Edad</label>
          <input type="number" class="form-input" id="e-edad" value="${alumno.edad || ''}" placeholder="años" min="5" max="99">
        </div>
        <div class="form-group">
          <label class="form-label">Peso (kg)</label>
          <input type="number" class="form-input" id="e-peso" value="${alumno.peso || ''}" placeholder="ej: 70" step="0.1">
        </div>
        <div class="form-group">
          <label class="form-label">Altura (cm)</label>
          <input type="number" class="form-input" id="e-altura" value="${alumno.altura || ''}" placeholder="ej: 165">
        </div>
      </div>
      <div class="form-group">
        <label class="form-label">DNI / CUIT de pagadores adicionales</label>
        <textarea class="form-input" id="e-cuits-alt" rows="2"
          placeholder="Ej: 30123456, 20301234567&#10;Uno por línea o separados por coma (padres, familiares, etc.)"
          style="resize:vertical;font-size:13px">${(() => {
            try { return JSON.parse(alumno.cuits_alternativos || '[]').join(', '); }
            catch(e) { return alumno.cuits_alternativos || ''; }
          })()}</textarea>
        <div style="font-size:11px;color:var(--text3);margin-top:4px">Se usan para identificar pagos del extracto bancario aunque no coincidan con el DNI del alumno.</div>
      </div>
      <button class="btn-primary" id="e-guardar">Guardar cambios</button>
      <button class="btn-secondary" id="e-cancelar">Cancelar</button>
    </div>`;

  document.body.appendChild(overlay);
  overlay.querySelector('#e-cancelar').onclick = () => overlay.remove();
  overlay.onclick = e => { if (e.target === overlay) overlay.remove(); };

  // Auto-fill cuota al cambiar actividad
  overlay.querySelector('#e-actividad').onchange = (e) => {
    const actId = parseInt(e.target.value);
    const act = actividades.find(a => a.id === actId);
    if (act) overlay.querySelector('#e-cuota').value = act.cuota;
  };

  overlay.querySelector('#e-guardar').onclick = async () => {
    const btn = overlay.querySelector('#e-guardar');
    btn.disabled = true; btn.innerHTML = '<span class="spinner"></span>';
    try {
      const updated = await api('PUT', `/alumnos/${alumno.id}`, {
        nombre: overlay.querySelector('#e-nombre').value,
        nivel: overlay.querySelector('#e-nivel').value,
        objetivo: overlay.querySelector('#e-objetivo').value,
        dias_por_semana: parseInt(overlay.querySelector('#e-dias').value),
        limitaciones: overlay.querySelector('#e-limit').value,
        dni: overlay.querySelector('#e-dni').value.trim() || null,
        cuit: overlay.querySelector('#e-cuit').value.trim() || null,
        fecha_inicio: overlay.querySelector('#e-fecha-inicio').value.trim() || null,
        cuota_mensual: parseFloat(overlay.querySelector('#e-cuota').value) || null,
        edad: parseInt(overlay.querySelector('#e-edad').value) || null,
        peso: parseFloat(overlay.querySelector('#e-peso').value) || null,
        altura: parseFloat(overlay.querySelector('#e-altura').value) || null,
        cuits_alternativos: (() => {
          const raw = overlay.querySelector('#e-cuits-alt').value;
          const lista = raw.split(/[,\n]/).map(s => s.trim()).filter(s => s.length > 0);
          return lista.length > 0 ? JSON.stringify(lista) : null;
        })(),
        actividad_id: parseInt(overlay.querySelector('#e-actividad').value) || null,
      });
      state.alumnoActual = { ...state.alumnoActual, ...updated };
      overlay.remove();
      toast('¡Alumno actualizado!', 'success');
      renderPerfilBody();
    } catch (e) {
      toast(e.message, 'error');
      btn.disabled = false; btn.innerHTML = 'Guardar cambios';
    }
  };
}

// ── Modal: Importar Alumnos.xlsx ──────────────────────────────────────────────
function mostrarModalImportarExcel() {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal">
      <div class="modal-drag"></div>
      <div class="modal-title">Importar Alumnos.xlsx</div>
      <p style="font-size:13px;color:var(--text2);margin-bottom:16px;line-height:1.5">
        Subí el archivo Excel con la lista de alumnos.<br>
        Columnas reconocidas: <strong>N° Orden, DNI, Apellido y Nombre, Fecha Inicio, CUIT, Monto, Peso, Altura, Edad, Objetivos</strong>.<br>
        Los alumnos existentes se actualizan; los nuevos se crean automáticamente.
      </p>
      <div class="form-group">
        <label class="form-label">Archivo Excel (.xlsx)</label>
        <input type="file" class="form-input" id="imp-archivo" accept=".xlsx,.xls" style="padding:8px">
      </div>
      <div id="imp-resultado" style="display:none;margin-bottom:12px;padding:12px;border-radius:8px;font-size:13px;line-height:1.5"></div>
      <button class="btn-primary" id="imp-confirmar">Importar</button>
      <button class="btn-secondary" id="imp-cancelar">Cancelar</button>
    </div>`;

  document.body.appendChild(overlay);
  overlay.querySelector('#imp-cancelar').onclick = () => overlay.remove();
  overlay.onclick = e => { if (e.target === overlay) overlay.remove(); };

  overlay.querySelector('#imp-confirmar').onclick = async () => {
    const fileInput = overlay.querySelector('#imp-archivo');
    const resultado = overlay.querySelector('#imp-resultado');
    if (!fileInput.files[0]) { toast('Seleccioná un archivo primero', 'error'); return; }

    const btn = overlay.querySelector('#imp-confirmar');
    btn.disabled = true; btn.innerHTML = '<span class="spinner"></span> Importando...';

    const formData = new FormData();
    formData.append('archivo', fileInput.files[0]);

    try {
      const resp = await fetch('/api/alumnos/importar-excel', { method: 'POST', body: formData });
      const data = await resp.json();
      if (!resp.ok) throw new Error(data.error || 'Error al importar');

      resultado.style.display = 'block';
      resultado.style.background = 'var(--success-bg, #e8f5e9)';
      resultado.style.color = '#2e7d32';
      resultado.innerHTML = `
        <strong>${data.mensaje}</strong><br>
        ${data.creados > 0 ? `✅ Nuevos: ${data.detalle.creados.join(', ')}<br>` : ''}
        ${data.actualizados > 0 ? `🔄 Actualizados: ${data.actualizados} alumnos<br>` : ''}
        ${data.errores > 0 ? `⚠️ Errores: ${data.errores}` : ''}
      `;
      btn.innerHTML = 'Importar otro';
      btn.disabled = false;

      // Recargar lista de alumnos
      state.alumnos = await api('GET', '/alumnos');
      renderPanelBody();
    } catch (e) {
      resultado.style.display = 'block';
      resultado.style.background = '#fdecea';
      resultado.style.color = '#c62828';
      resultado.textContent = 'Error: ' + e.message;
      btn.innerHTML = 'Reintentar';
      btn.disabled = false;
    }
  };
}

// ── Pantalla 3: Escáner ───────────────────────────────────────────────────────
function renderScanner(container) {
  container.innerHTML = `
    <div class="screen active" id="screen-scanner">
      <div class="header">
        <button class="back-btn" id="btn-back">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M15 18l-6-6 6-6"/></svg>
          Atrás
        </button>
        <div class="header-title">Escanear planilla</div>
      </div>
      <div class="content">
        <input type="file" id="file-input" accept="image/*" capture="environment" style="display:none">

        <div class="upload-zone" id="upload-zone">
          <div class="upload-icon">📸</div>
          <p class="upload-text">Tocá para seleccionar foto</p>
          <p class="upload-hint">O arrastrá la imagen aquí</p>
        </div>

        <div id="scan-progress" style="display:none">
          <div class="progress-scan"><div class="progress-scan-fill"></div></div>
          <p style="font-size:13px;color:var(--text2);text-align:center;margin-bottom:16px">Analizando con IA...</p>
        </div>

        <div id="scan-result" style="display:none"></div>

        <button class="btn-primary" id="btn-leer" disabled>Leer con IA</button>
        <button class="btn-secondary" id="btn-confirmar" style="display:none">Confirmar y guardar</button>
      </div>
    </div>`;

  document.getElementById('btn-back').onclick = () => navigate('panel');

  const fileInput = document.getElementById('file-input');
  const uploadZone = document.getElementById('upload-zone');
  let imageBase64 = null;
  let scanJson = null;

  uploadZone.onclick = () => fileInput.click();
  uploadZone.ondragover = e => { e.preventDefault(); uploadZone.style.borderColor = 'var(--text)'; };
  uploadZone.ondragleave = () => { uploadZone.style.borderColor = ''; };
  uploadZone.ondrop = e => {
    e.preventDefault(); uploadZone.style.borderColor = '';
    const file = e.dataTransfer.files[0];
    if (file) cargarImagen(file);
  };

  fileInput.onchange = e => {
    const file = e.target.files[0];
    if (file) cargarImagen(file);
  };

  function cargarImagen(file) {
    const reader = new FileReader();
    reader.onload = e => {
      imageBase64 = e.target.result;
      uploadZone.innerHTML = `<img src="${imageBase64}" class="upload-preview">`;
      uploadZone.classList.add('has-image');
      document.getElementById('btn-leer').disabled = false;
    };
    reader.readAsDataURL(file);
  }

  document.getElementById('btn-leer').onclick = async () => {
    if (!imageBase64) return;
    const btn = document.getElementById('btn-leer');
    btn.disabled = true; btn.innerHTML = '<span class="spinner"></span> Procesando...';
    document.getElementById('scan-progress').style.display = 'block';
    document.getElementById('scan-result').style.display = 'none';
    document.getElementById('btn-confirmar').style.display = 'none';

    try {
      scanJson = await api('POST', '/scan', { imagen: imageBase64 });
      document.getElementById('scan-progress').style.display = 'none';
      renderScanResult(scanJson);
      document.getElementById('btn-confirmar').style.display = 'block';
    } catch (e) {
      document.getElementById('scan-progress').style.display = 'none';
      toast(e.message, 'error');
    }
    btn.disabled = false; btn.innerHTML = 'Leer con IA';
  };

  document.getElementById('btn-confirmar').onclick = async () => {
    if (!scanJson) return;
    await guardarDesdeEscaneo(scanJson);
  };
}

function renderScanResult(data) {
  const container = document.getElementById('scan-result');
  container.style.display = 'block';

  const circuitosHTML = (data.circuitos || []).map((c, i) => `
    <div class="circuito-scan-card">
      <div class="circuito-scan-title">Circuito ${i + 1} — ${c.series || 4} series</div>
      <div class="scan-campo-wrap">
        <label class="form-label">Ejercicio principal</label>
        <input type="text" class="form-input" data-circ="${i}" data-field="principal" value="${c.principal || ''}">
      </div>
      <div class="form-row">
        <div class="scan-campo-wrap">
          <label class="form-label">Pesos por serie</label>
          <input type="text" class="form-input" data-circ="${i}" data-field="pesos_por_serie" value="${c.pesos_por_serie || ''}">
        </div>
        <div class="scan-campo-wrap">
          <label class="form-label">Rango reps</label>
          <input type="text" class="form-input" data-circ="${i}" data-field="rango_reps" value="${c.rango_reps || ''}">
        </div>
      </div>
      <div class="scan-campo-wrap">
        <label class="form-label">Complemento</label>
        <input type="text" class="form-input" data-circ="${i}" data-field="complemento" value="${c.complemento || ''}">
      </div>
      <div class="form-row">
        <div class="scan-campo-wrap">
          <label class="form-label">Reps complemento</label>
          <input type="text" class="form-input" data-circ="${i}" data-field="reps_complemento" value="${c.reps_complemento || ''}">
        </div>
        <div class="scan-campo-wrap">
          <label class="form-label">Peso complemento</label>
          <input type="text" class="form-input" data-circ="${i}" data-field="peso_complemento" value="${c.peso_complemento || ''}">
        </div>
      </div>
    </div>`).join('');

  container.innerHTML = `
    <div class="scan-result-card">
      <div class="scan-result-title">Datos extraídos — revisá y editá</div>

      <div class="scan-campo-wrap">
        <label class="form-label">Nombre del alumno</label>
        <input type="text" class="form-input" id="scan-nombre" value="${data.nombre || ''}">
      </div>
      <div class="form-row">
        <div class="scan-campo-wrap">
          <label class="form-label">Plan</label>
          <select class="form-select" id="scan-plan">
            <option ${data.plan === 'A' ? 'selected' : ''}>A</option>
            <option ${data.plan === 'B' ? 'selected' : ''}>B</option>
          </select>
        </div>
        <div class="scan-campo-wrap">
          <label class="form-label">Fecha</label>
          <input type="text" class="form-input" id="scan-fecha" value="${data.fecha || ''}">
        </div>
      </div>
      <div class="scan-campo-wrap completar">
        <label class="form-label">Nivel</label>
        <select class="form-select" id="scan-nivel">
          <option>Principiante</option><option>Intermedio</option><option>Avanzado</option>
        </select>
      </div>
      <div class="scan-campo-wrap completar">
        <label class="form-label">Objetivo</label>
        <input type="text" class="form-input" id="scan-objetivo" placeholder="ej: Fuerza + glúteos">
      </div>
      <div class="form-row">
        <div class="scan-campo-wrap completar">
          <label class="form-label">Días por semana</label>
          <input type="number" class="form-input" id="scan-dias" value="4" min="1" max="7">
        </div>
        <div class="scan-campo-wrap completar">
          <label class="form-label">Limitaciones</label>
          <input type="text" class="form-input" id="scan-limit" value="Ninguna">
        </div>
      </div>
      <div class="scan-campo-wrap">
        <label class="form-label">Entrada en calor</label>
        <input type="text" class="form-input" id="scan-ec" value="${data.entrada_en_calor || ''}">
      </div>
    </div>

    <div class="section-label">Circuitos</div>
    <div id="scan-circuitos">${circuitosHTML}</div>`;

  // Sync cambios a scanJson
  container.querySelectorAll('[data-circ]').forEach(input => {
    input.oninput = () => {
      const i = parseInt(input.dataset.circ);
      const field = input.dataset.field;
      if (!scanJson.circuitos[i]) scanJson.circuitos[i] = {};
      scanJson.circuitos[i][field] = input.value;
    };
  });
}

async function guardarDesdeEscaneo(data) {
  const nombre = document.getElementById('scan-nombre')?.value?.trim();
  if (!nombre) { toast('Ingresá el nombre del alumno', 'error'); return; }

  const btn = document.getElementById('btn-confirmar');
  btn.disabled = true; btn.innerHTML = '<span class="spinner"></span> Guardando...';

  try {
    // Crear o buscar alumno
    const nivel = document.getElementById('scan-nivel')?.value || 'Principiante';
    const objetivo = document.getElementById('scan-objetivo')?.value || '';
    const dias = parseInt(document.getElementById('scan-dias')?.value || '4');
    const limitaciones = document.getElementById('scan-limit')?.value || 'Ninguna';
    const plan = document.getElementById('scan-plan')?.value || 'A';
    const ec = document.getElementById('scan-ec')?.value || '';

    // Crear alumno nuevo
    const alumno = await api('POST', '/alumnos', { nombre, nivel, objetivo, dias_por_semana: dias, limitaciones });

    // Construir circuitos
    const circuitos = (data.circuitos || []).map((c, i) => ({
      orden: i + 1,
      series: c.series || 4,
      principal: { nombre: c.principal, notas: `${c.pesos_por_serie || ''} — reps: ${c.rango_reps || ''}` },
      complemento: c.complemento ? { nombre: c.complemento, notas: [c.reps_complemento, c.peso_complemento].filter(Boolean).join(' — ') } : null
    }));

    // Crear ciclo con plan
    await api('POST', `/alumnos/${alumno.id}/ciclos`, {
      planes: [{ tipo: plan, entrada_en_calor: ec, circuitos }]
    });

    navigate('confirmacion', {
      titulo: '¡Alumno cargado!',
      mensaje: `Se creó el perfil de ${nombre} con ${circuitos.length} circuitos.`,
      resumen: [
        { k: 'Alumno', v: nombre },
        { k: 'Plan', v: `Plan ${plan}` },
        { k: 'Circuitos', v: circuitos.length },
        { k: 'Nivel', v: nivel }
      ]
    });
  } catch (e) {
    toast(e.message, 'error');
    btn.disabled = false; btn.innerHTML = 'Confirmar y guardar';
  }
}

// ── Pantalla 4: Nuevo alumno manual ──────────────────────────────────────────
function renderNuevoManual(container, { alumnoId } = {}) {
  const fm = state.formNuevoAlumno;
  fm.paso = 1;
  fm.datos = { dias_por_semana: 4 };
  fm.planesData = { A: { ec: '', circuitos: [] }, B: { ec: '', circuitos: [] } };

  container.innerHTML = `
    <div class="screen active" id="screen-nuevo">
      <div class="header">
        <button class="back-btn" id="btn-back">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M15 18l-6-6 6-6"/></svg>
          Atrás
        </button>
        <div class="header-title">Nuevo alumno</div>
      </div>
      <div class="content" id="nuevo-body"></div>
    </div>`;

  document.getElementById('btn-back').onclick = () => navigate('panel');
  renderPasoActual();
}

function renderPasoActual() {
  const body = document.getElementById('nuevo-body');
  if (!body) return;
  const fm = state.formNuevoAlumno;
  const dias = fm.datos.dias_por_semana || 4;
  const maxPasos = dias >= 4 ? 4 : 3;
  const dotLabels = ['Datos', 'Plan A', dias >= 4 ? 'Plan B' : null, 'Confirmar'].filter(Boolean);

  const dots = dotLabels.map((_, i) => {
    const n = i + 1;
    const cls = n < fm.paso ? 'done' : n === fm.paso ? 'active' : '';
    return `<div class="step-dot ${cls}"></div>`;
  }).join('');

  let contenido = '';
  if (fm.paso === 1) contenido = renderPaso1HTML(fm);
  else if (fm.paso === 2) contenido = renderPasoPlaneHTML(fm, 'A');
  else if (fm.paso === 3 && dias >= 4) contenido = renderPasoPlaneHTML(fm, 'B');
  else contenido = renderPasoConfirmHTML(fm);

  body.innerHTML = `
    <div class="steps-indicator">${dots}</div>
    ${contenido}`;

  // Botones nav
  const btnNext = body.querySelector('#btn-next');
  const btnPrev = body.querySelector('#btn-prev');
  if (btnNext) btnNext.onclick = () => avanzarPaso();
  if (btnPrev) btnPrev.onclick = () => { fm.paso--; renderPasoActual(); };

  // Btn agregar circuito
  body.querySelectorAll('.btn-add-circuito').forEach(btn => {
    btn.onclick = () => {
      const plan = btn.dataset.plan;
      fm.planesData[plan].circuitos.push({ principal: '', pesos: ['', '', '', ''], repsMin: '', repsMax: '', complemento: '', repsComp: '', series: 4 });
      guardarCamposPlan(plan);
      renderPasoActual();
    };
  });

  // Btn eliminar circuito
  body.querySelectorAll('.btn-remove-circuito').forEach(btn => {
    btn.onclick = () => {
      const plan = btn.dataset.plan;
      const idx = parseInt(btn.dataset.idx);
      guardarCamposPlan(plan);
      fm.planesData[plan].circuitos.splice(idx, 1);
      renderPasoActual();
    };
  });
}

function renderPaso1HTML(fm) {
  const d = fm.datos;
  return `
    <div class="step-header">
      <h2>Datos del alumno</h2>
      <p>Información básica del perfil</p>
    </div>
    <div class="form-group">
      <label class="form-label">Nombre *</label>
      <input type="text" class="form-input" id="f-nombre" value="${d.nombre || ''}" placeholder="Nombre completo">
    </div>
    <div class="form-group">
      <label class="form-label">Nivel</label>
      <select class="form-select" id="f-nivel">
        ${['Principiante','Intermedio','Avanzado'].map(n => `<option ${d.nivel === n ? 'selected' : ''}>${n}</option>`).join('')}
      </select>
    </div>
    <div class="form-group">
      <label class="form-label">Objetivo</label>
      <input type="text" class="form-input" id="f-objetivo" value="${d.objetivo || ''}" placeholder="ej: Fuerza + glúteos">
    </div>
    <div class="form-row">
      <div class="form-group">
        <label class="form-label">Días por semana</label>
        <select class="form-select" id="f-dias">
          ${[1,2,3,4,5,6].map(n => `<option ${d.dias_por_semana === n ? 'selected' : ''}>${n}</option>`).join('')}
        </select>
      </div>
      <div class="form-group">
        <label class="form-label">Limitaciones</label>
        <input type="text" class="form-input" id="f-limit" value="${d.limitaciones || ''}" placeholder="Ninguna">
      </div>
    </div>
    <button class="btn-primary" id="btn-next">Siguiente →</button>`;
}

function renderPasoPlaneHTML(fm, plan) {
  const pd = fm.planesData[plan];
  const circs = pd.circuitos;
  const circsHTML = circs.map((c, i) => `
    <div class="circuito-form-card">
      <div class="circuito-form-title">
        Circuito ${i + 1}
        <button class="btn-remove-circuito" data-plan="${plan}" data-idx="${i}">Eliminar</button>
      </div>
      <div class="form-group">
        <label class="form-label">Series</label>
        <select class="form-select" data-plan="${plan}" data-idx="${i}" data-f="series">
          ${[3,4,5].map(n => `<option ${(c.series||4) === n ? 'selected' : ''}>${n}</option>`).join('')}
        </select>
      </div>
      <div class="form-group">
        <label class="form-label">Ejercicio principal *</label>
        <input type="text" class="form-input" data-plan="${plan}" data-idx="${i}" data-f="principal" value="${c.principal || ''}" placeholder="ej: Hip Thrust c/barra">
      </div>
      <label class="form-label">Pesos por serie</label>
      <div class="pesos-grid" style="margin-bottom:12px">
        ${[0,1,2,3].map(s => `
          <div class="pesos-input-wrap">
            <span class="pesos-input-label">S${s+1}</span>
            <input type="text" class="form-input" data-plan="${plan}" data-idx="${i}" data-f="peso${s}" value="${c.pesos?.[s] || ''}" placeholder="kg">
          </div>`).join('')}
      </div>
      <div class="form-row">
        <div class="form-group">
          <label class="form-label">Reps mín</label>
          <input type="number" class="form-input" data-plan="${plan}" data-idx="${i}" data-f="repsMin" value="${c.repsMin || ''}" placeholder="4">
        </div>
        <div class="form-group">
          <label class="form-label">Reps máx</label>
          <input type="number" class="form-input" data-plan="${plan}" data-idx="${i}" data-f="repsMax" value="${c.repsMax || ''}" placeholder="6">
        </div>
      </div>
      <div class="form-group">
        <label class="form-label">Ejercicio complementario</label>
        <input type="text" class="form-input" data-plan="${plan}" data-idx="${i}" data-f="complemento" value="${c.complemento || ''}" placeholder="ej: Abs colgada">
      </div>
      <div class="form-row">
        <div class="form-group">
          <label class="form-label">Reps complemento</label>
          <input type="text" class="form-input" data-plan="${plan}" data-idx="${i}" data-f="repsComp" value="${c.repsComp || ''}" placeholder="x8">
        </div>
        <div class="form-group">
          <label class="form-label">Peso complemento</label>
          <input type="text" class="form-input" data-plan="${plan}" data-idx="${i}" data-f="pesoComp" value="${c.pesoComp || ''}" placeholder="kg">
        </div>
      </div>
    </div>`).join('');

  return `
    <div class="step-header">
      <h2>Plan ${plan}</h2>
      <p>Entrada en calor y circuitos del Plan ${plan}</p>
    </div>
    <div class="form-group">
      <label class="form-label">Entrada en calor</label>
      <textarea class="form-textarea" id="f-ec-${plan}" placeholder="ej: Plancha x10, Sentadilla sumo x10...">${pd.ec || ''}</textarea>
    </div>
    ${circsHTML}
    <button class="btn-add-circuito" data-plan="${plan}">+ Agregar circuito</button>
    <button class="btn-primary" id="btn-next">Siguiente →</button>
    <button class="btn-secondary" id="btn-prev">← Atrás</button>`;
}

function renderPasoConfirmHTML(fm) {
  const d = fm.datos;
  const planesKeys = Object.keys(fm.planesData).filter(p => fm.planesData[p].circuitos.length > 0);
  return `
    <div class="step-header">
      <h2>Confirmación</h2>
      <p>Revisá los datos antes de guardar</p>
    </div>
    <div class="scan-result-card" style="margin-bottom:14px">
      <div class="scan-result-title">Alumno</div>
      <div style="font-size:15px;font-weight:600">${d.nombre || '—'}</div>
      <div style="font-size:13px;color:var(--text2);margin-top:4px">${d.nivel} · ${d.dias_por_semana} días/semana · ${d.objetivo || 'Sin objetivo'}</div>
      ${d.limitaciones ? `<div style="font-size:12px;color:var(--text3);margin-top:2px">Limitaciones: ${d.limitaciones}</div>` : ''}
    </div>
    ${planesKeys.map(p => `
    <div class="scan-result-card" style="margin-bottom:14px">
      <div class="scan-result-title">Plan ${p} — ${fm.planesData[p].circuitos.length} circuitos</div>
      ${fm.planesData[p].circuitos.map((c, i) => `
        <div style="padding:6px 0;border-bottom:1px solid var(--border)">
          <div style="font-size:13px;font-weight:600">${i + 1}. ${c.principal || '—'}</div>
          <div style="font-size:12px;color:var(--text3)">${[c.pesos?.filter(Boolean).join(','), c.repsMin && c.repsMax ? `reps: ${c.repsMin}-${c.repsMax}` : ''].filter(Boolean).join(' — ')}</div>
          ${c.complemento ? `<div style="font-size:12px;color:var(--text2)">+ ${c.complemento}</div>` : ''}
        </div>`).join('')}
    </div>`).join('')}
    <button class="btn-primary" id="btn-next">Guardar alumno</button>
    <button class="btn-secondary" id="btn-prev">← Atrás</button>`;
}

function guardarCamposPlan(plan) {
  const fm = state.formNuevoAlumno;
  const body = document.getElementById('nuevo-body');
  if (!body) return;
  const ecEl = document.getElementById(`f-ec-${plan}`);
  if (ecEl) fm.planesData[plan].ec = ecEl.value;

  body.querySelectorAll(`[data-plan="${plan}"]`).forEach(el => {
    if (el.dataset.f === undefined) return;
    const idx = parseInt(el.dataset.idx);
    if (isNaN(idx)) return;
    const f = el.dataset.f;
    if (!fm.planesData[plan].circuitos[idx]) return;
    if (f.startsWith('peso') && !f.includes('Comp')) {
      const s = parseInt(f.replace('peso', ''));
      if (!fm.planesData[plan].circuitos[idx].pesos) fm.planesData[plan].circuitos[idx].pesos = ['','','',''];
      fm.planesData[plan].circuitos[idx].pesos[s] = el.value;
    } else {
      fm.planesData[plan].circuitos[idx][f] = el.value;
    }
  });
}

function guardarPaso1() {
  const fm = state.formNuevoAlumno;
  const body = document.getElementById('nuevo-body');
  fm.datos.nombre = body.querySelector('#f-nombre')?.value?.trim();
  fm.datos.nivel = body.querySelector('#f-nivel')?.value;
  fm.datos.objetivo = body.querySelector('#f-objetivo')?.value?.trim();
  fm.datos.dias_por_semana = parseInt(body.querySelector('#f-dias')?.value || '4');
  fm.datos.limitaciones = body.querySelector('#f-limit')?.value?.trim() || 'Ninguna';
}

async function avanzarPaso() {
  const fm = state.formNuevoAlumno;
  const dias = parseInt(document.getElementById('f-dias')?.value || fm.datos.dias_por_semana || 4);
  const maxPasos = dias >= 4 ? 4 : 3;

  if (fm.paso === 1) {
    guardarPaso1();
    if (!fm.datos.nombre) { toast('El nombre es requerido', 'error'); return; }
    fm.paso = 2;
    renderPasoActual();
    return;
  }

  if (fm.paso === 2) {
    guardarCamposPlan('A');
    fm.paso = dias >= 4 ? 3 : 4;
    renderPasoActual();
    return;
  }

  if (fm.paso === 3) {
    guardarCamposPlan('B');
    fm.paso = 4;
    renderPasoActual();
    return;
  }

  if (fm.paso === maxPasos) {
    // Guardar
    const btn = document.getElementById('btn-next');
    btn.disabled = true; btn.innerHTML = '<span class="spinner"></span> Guardando...';
    try {
      await guardarNuevoAlumno();
    } catch (e) {
      toast(e.message, 'error');
      btn.disabled = false; btn.innerHTML = 'Guardar alumno';
    }
  }
}

async function guardarNuevoAlumno() {
  const fm = state.formNuevoAlumno;
  const { nombre, nivel, objetivo, dias_por_semana, limitaciones } = fm.datos;

  const alumno = await api('POST', '/alumnos', { nombre, nivel, objetivo, dias_por_semana, limitaciones });

  const planesPayload = [];
  for (const planTipo of ['A', 'B']) {
    if (planTipo === 'B' && dias_por_semana < 4) continue;
    const pd = fm.planesData[planTipo];
    if (pd.circuitos.length === 0 && planTipo === 'B') continue;

    const circuitos = pd.circuitos.map((c, i) => ({
      orden: i + 1,
      series: parseInt(c.series) || 4,
      principal: {
        nombre: c.principal,
        notas: `${c.pesos?.filter(Boolean).join(',') || ''}${c.repsMin && c.repsMax ? ' — reps: ' + c.repsMin + '-' + c.repsMax : ''}`
      },
      complemento: c.complemento ? {
        nombre: c.complemento,
        notas: [c.repsComp, c.pesoComp].filter(Boolean).join(' — ')
      } : null
    }));

    planesPayload.push({ tipo: planTipo, entrada_en_calor: pd.ec, circuitos });
  }

  if (planesPayload.length > 0) {
    await api('POST', `/alumnos/${alumno.id}/ciclos`, { planes: planesPayload });
  }

  navigate('confirmacion', {
    titulo: '¡Alumno creado!',
    mensaje: `${nombre} fue agregado con éxito.`,
    resumen: [
      { k: 'Nombre', v: nombre },
      { k: 'Nivel', v: nivel },
      { k: 'Días/semana', v: dias_por_semana },
      { k: 'Planes', v: planesPayload.map(p => 'Plan ' + p.tipo).join(', ') || 'Sin plan' }
    ]
  });
}

// ── Pantalla 5: Propuesta de ciclo nuevo ──────────────────────────────────────
function renderPropuesta(container, { alumnoId }) {
  const p = state.propuesta;
  if (!p) { navigate('panel'); return; }

  container.innerHTML = `
    <div class="screen active" id="screen-propuesta">
      <div class="header">
        <button class="back-btn" id="btn-back">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M15 18l-6-6 6-6"/></svg>
          Atrás
        </button>
        <div class="header-title">Ciclo ${p.numero_ciclo_nuevo}</div>
      </div>
      <div class="content">
        <div class="step-header">
          <h2>Propuesta ciclo ${p.numero_ciclo_nuevo}</h2>
          <p>Basada en el rendimiento del ciclo anterior. Editá los valores si querés ajustar.</p>
        </div>

        ${p.propuesta.map(plan => `
          <div class="section-label">Plan ${plan.tipo}</div>
          ${plan.circuitos.map((circ, i) => propuestaCircuitoHTML(plan.tipo, circ, i)).join('')}
        `).join('')}

        <button class="btn-primary" id="btn-confirmar-ciclo">
          Confirmar ciclo ${p.numero_ciclo_nuevo}
        </button>
        <button class="btn-secondary" id="btn-imprimir-planilla" style="background:var(--card);border:1.5px solid var(--border)">
          🖨 Imprimir planilla
        </button>
        <button class="btn-secondary" id="btn-back2">Cancelar</button>
      </div>
    </div>`;

  document.getElementById('btn-back').onclick = () => navigate('perfil', { id: alumnoId });
  document.getElementById('btn-back2').onclick = () => navigate('perfil', { id: alumnoId });

  document.getElementById('btn-imprimir-planilla').onclick = () => {
    const alumno = state.alumnoActual;
    imprimirPlanilla(alumno, p);
  };

  document.getElementById('btn-confirmar-ciclo').onclick = async () => {
    const btn = document.getElementById('btn-confirmar-ciclo');
    btn.disabled = true; btn.innerHTML = '<span class="spinner"></span> Creando ciclo...';
    try {
      await confirmarCicloNuevo(alumnoId);
    } catch (e) {
      toast(e.message, 'error');
      btn.disabled = false; btn.innerHTML = `Confirmar ciclo ${p.numero_ciclo_nuevo}`;
    }
  };
}

function propuestaCircuitoHTML(plan, circ, i) {
  const pr = circ.principal;
  const razonClase = pr.razon && pr.razon.includes('techo') ? '' : pr.razon && pr.razon.includes('consistentemente') ? 'nocomp' : 'mismo';
  const compAnterior = circ.complemento?.nombre_anterior || circ.complemento?.nombre || '';
  return `
    <div class="propuesta-card">
      <div class="propuesta-header">
        <div class="propuesta-ejercicio">${circ.orden}.</div>
      </div>
      <div class="propuesta-body">
        <div class="propuesta-row">
          <div class="propuesta-col">
            <div class="col-label">Ciclo anterior</div>
            <div class="col-ejercicio-ant">${pr.nombre_anterior || pr.nombre || '—'}</div>
            <div class="col-valor">${pr.pesos_anteriores || '—'}</div>
            <div style="font-size:11px;color:var(--text3);margin-top:2px">Reps: ${pr.reps_anteriores || '—'}</div>
          </div>
          <div class="propuesta-col">
            <div class="col-label">Propuesta nueva</div>
            <input type="text" class="prop-input-nombre"
              placeholder="Nombre del ejercicio..."
              data-plan="${plan}" data-circ="${i}" data-f="nombre"
              value="${pr.nombre || ''}">
            <input type="text" class="prop-input-peso"
              placeholder="Peso por serie (ej: 20, 20, 25)"
              data-plan="${plan}" data-circ="${i}" data-f="pesos"
              value="${pr.pesos_nuevos || ''}">
            <div class="prop-reps-row">
              <span style="font-size:12px;color:var(--text2)">Reps:</span>
              <input type="text" class="prop-input-reps"
                placeholder="ej: 8-10"
                data-plan="${plan}" data-circ="${i}" data-f="reps"
                value="${pr.reps_nuevas || ''}">
            </div>
          </div>
        </div>
        <div><span class="razon-tag ${razonClase}">${pr.razon || ''}</span></div>
        ${circ.complemento ? `
        <div class="comp-row">
          <span class="comp-badge">COMP</span>
          <div class="comp-anterior">${compAnterior}</div>
          <input type="text" class="prop-input-comp"
            placeholder="Complemento nuevo..."
            data-plan="${plan}" data-circ="${i}" data-f="comp_nombre"
            value="${circ.complemento.nombre || ''}">
        </div>` : ''}
      </div>
    </div>`;
}

async function confirmarCicloNuevo(alumnoId) {
  const p = state.propuesta;
  const container = document.getElementById('screen-propuesta');

  // Leer valores editados
  const editados = {};
  container.querySelectorAll('[data-plan][data-circ][data-f]').forEach(input => {
    const plan = input.dataset.plan;
    const circ = parseInt(input.dataset.circ);
    const f = input.dataset.f;
    if (!editados[plan]) editados[plan] = {};
    if (!editados[plan][circ]) editados[plan][circ] = {};
    editados[plan][circ][f] = input.value;
  });

  // Construir payload
  const planesPayload = p.propuesta.map(plan => {
    const circuitos = plan.circuitos.map((circ, i) => {
      const ed = editados[plan.tipo]?.[i] || {};
      const nombre = ed.nombre || circ.principal.nombre || '';
      const pesos  = ed.pesos  || circ.principal.pesos_nuevos || '';
      const reps   = ed.reps   || circ.principal.reps_nuevas  || '';
      const compNombre = ed.comp_nombre || circ.complemento?.nombre || '';
      return {
        orden: circ.orden,
        series: circ.series,
        principal: {
          nombre: nombre,
          notas: pesos ? `${pesos} — reps: ${reps}` : ''
        },
        complemento: circ.complemento ? { nombre: compNombre, notas: circ.complemento.notas || '' } : null
      };
    });
    return { tipo: plan.tipo, entrada_en_calor: plan.entrada_en_calor, circuitos };
  });

  await api('POST', `/alumnos/${alumnoId}/ciclos`, { planes: planesPayload });

  navigate('confirmacion', {
    titulo: `¡Ciclo ${p.numero_ciclo_nuevo} creado!`,
    mensaje: `El nuevo ciclo fue generado y está listo para comenzar.`,
    resumen: [
      { k: 'Ciclo', v: p.numero_ciclo_nuevo },
      { k: 'Planes', v: p.propuesta.map(pl => 'Plan ' + pl.tipo).join(', ') },
      { k: 'Basado en', v: `Ciclo ${p.ciclo_anterior}` }
    ],
    alumnoId
  });
}

// ── Imprimir planilla de ciclo ────────────────────────────────────────────────
function imprimirPlanilla(alumno, propuesta) {
  // Leer valores editados en los inputs de la pantalla de propuesta
  const container = document.getElementById('screen-propuesta');
  const editados = {};
  if (container) {
    container.querySelectorAll('[data-plan][data-circ][data-f]').forEach(input => {
      const plan = input.dataset.plan;
      const circ = parseInt(input.dataset.circ);
      const f    = input.dataset.f;
      if (!editados[plan]) editados[plan] = {};
      if (!editados[plan][circ]) editados[plan][circ] = {};
      editados[plan][circ][f] = input.value;
    });
  }

  const hoy = new Date();
  const fechaStr = hoy.toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric' });

  // Genera filas de series para un ejercicio (N filas según series)
  // La primera fila va resaltada con los datos propuestos
  function filasSeriesHTML(series, propStr) {
    const n = parseInt(series) || 4;
    const COLS = 8; // casilleros por fila
    let rows = '';
    for (let i = 0; i < n; i++) {
      const highlighted = i === 0;
      const seriesCls   = highlighted ? 'ser-num primera' : 'ser-num';
      const contenido   = highlighted && propStr
        ? `<td colspan="${COLS}" class="data-box prop-data">${propStr}</td>`
        : Array.from({length: COLS}, () => `<td class="data-box"></td>`).join('');
      rows += `<tr><td class="${seriesCls}">${i + 1}</td>${contenido}</tr>`;
    }
    return rows;
  }

  // Genera el bloque HTML de cada plan
  const planesHTML = propuesta.propuesta.map(plan => {
    const COLS = 8;

    // Fila de entrada en calor
    const ecHTML = plan.entrada_en_calor
      ? `<tr class="ec-row"><td class="ser-num"></td><td colspan="${COLS}" class="ec-cell">${plan.entrada_en_calor}</td></tr>`
      : `<tr class="ec-row"><td class="ser-num"></td><td colspan="${COLS}" class="ec-cell"></td></tr>`;

    // Filas de circuitos
    const circsHTML = plan.circuitos.map((circ, i) => {
      const ed = editados[plan.tipo]?.[i] || {};
      const nombre     = ed.nombre      || circ.principal.nombre       || '';
      const pesos      = ed.pesos       || circ.principal.pesos_nuevos || '';
      const reps       = ed.reps        || circ.principal.reps_nuevas  || '';
      const compNombre = ed.comp_nombre || circ.complemento?.nombre    || '';
      const propStr    = [pesos, reps ? 'reps: ' + reps : ''].filter(Boolean).join(' · ');

      // Fila con nombre del ejercicio principal
      const nombreRow = `
        <tr class="ej-name-row">
          <td class="ser-num"></td>
          <td colspan="${COLS}" class="ej-name-cell">
            ${nombre || '—'}
            ${propStr ? `<span class="prop-hint">(${propStr})</span>` : ''}
          </td>
        </tr>`;

      // Filas de series del ejercicio principal
      const seriesRows = filasSeriesHTML(circ.series, '');

      // Bloque del complemento (si existe) — una sola fila sin renglones de series
      const compHTML = compNombre ? `
        <tr class="comp-name-row">
          <td class="ser-num"></td>
          <td colspan="${COLS}" class="comp-name-cell"><span class="comp-tag">COMP</span> ${compNombre}</td>
        </tr>
        <tr class="comp-single-row">
          <td class="ser-num"></td>
          <td colspan="${COLS}" class="comp-single-cell"></td>
        </tr>` : '';

      // Separador entre ejercicios
      const separador = `<tr class="sep-row"><td colspan="${COLS + 1}"></td></tr>`;

      return nombreRow + seriesRows + compHTML + separador;
    }).join('');

    return `
      <div class="plan-block">
        <table class="rutina-table">
          <colgroup>
            <col class="col-series">
            ${Array.from({length: COLS}, (_, i) => `<col class="${(i % 2 === 0) ? 'col-angosta' : 'col-ancha'}">`).join('')}
          </colgroup>
          <thead>
            <tr>
              <th class="th-series">SERIES</th>
              <th colspan="${COLS}" class="th-ec">
                PLAN ${plan.tipo} — ENTRADA EN CALOR
              </th>
            </tr>
          </thead>
          <tbody>
            ${ecHTML}
            ${circsHTML}
            <tr class="parte-final-row">
              <td class="ser-num"></td>
              <td colspan="${COLS}" class="parte-final-cell">PARTE FINAL</td>
            </tr>
          </tbody>
        </table>
      </div>`;
  }).join('');

  const html = `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <title>Planilla - ${alumno.nombre} - Ciclo ${propuesta.numero_ciclo_nuevo}</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: Arial, sans-serif;
      font-size: 11px;
      color: #111;
      background: #fff;
      padding: 10px 14px;
    }

    /* ── Encabezado ── */
    .header-planilla {
      display: flex;
      justify-content: space-between;
      align-items: center;
      border-bottom: 2.5px solid #111;
      padding-bottom: 7px;
      margin-bottom: 12px;
    }
    .alumno-nombre { font-size: 18px; font-weight: 800; }
    .header-right  { text-align: right; }
    .ciclo-badge {
      display: inline-block;
      background: #111; color: #fff;
      padding: 2px 12px; border-radius: 12px;
      font-size: 12px; font-weight: 700;
    }
    .fecha-txt { font-size: 10px; color: #666; margin-top: 3px; }

    /* ── Plan block ── */
    .plan-block { margin-bottom: 18px; }

    /* ── Tabla ── */
    .rutina-table {
      width: 100%;
      border-collapse: collapse;
      table-layout: fixed;
    }

    /* Encabezado de tabla */
    .th-series {
      width: 44px;
      background: #111; color: #fff;
      font-size: 9px; font-weight: 800;
      text-align: center;
      border: 1px solid #111;
      padding: 4px 2px;
      letter-spacing: 0.5px;
    }
    .th-ec {
      background: #111; color: #fff;
      font-size: 11px; font-weight: 800;
      text-align: center;
      border: 1px solid #111;
      padding: 4px 6px;
      letter-spacing: 1px;
    }

    /* Fila entrada en calor */
    .ec-row td { border: 1px solid #ccc; }
    .ec-cell {
      height: 28px;
      padding: 4px 8px;
      font-size: 11px;
      vertical-align: middle;
    }

    /* Fila con nombre del ejercicio */
    .ej-name-row td { border: 1px solid #bbb; }
    .ej-name-cell {
      background: #f2f2f2;
      font-weight: 700;
      font-size: 11px;
      padding: 4px 8px;
      text-align: center;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      border-top: 1.5px solid #888 !important;
    }
    .prop-hint {
      font-weight: 400;
      font-size: 9px;
      color: #666;
      margin-left: 6px;
      text-transform: none;
      letter-spacing: 0;
    }

    /* Fila con nombre del complemento */
    .comp-name-row td { border: 1px solid #bbb; }
    .comp-name-cell {
      background: #f8f8f8;
      font-size: 10.5px;
      padding: 3px 8px;
      text-align: center;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      border-top: 1px dashed #aaa !important;
    }
    .comp-tag {
      background: #ddd;
      padding: 1px 5px;
      border-radius: 3px;
      font-size: 8.5px;
      font-weight: 700;
      margin-right: 4px;
    }

    /* Número de serie */
    .ser-num {
      width: 44px;
      text-align: center;
      font-size: 11px;
      font-weight: 700;
      border: 1px solid #ccc;
      padding: 0;
      height: 26px;
      vertical-align: middle;
    }
    /* Primera serie de cada ejercicio: fondo amarillo */
    .ser-num.primera {
      background: #ffe066;
      border-color: #bbb;
    }

    /* Casilleros de datos */
    .data-box {
      border: 1px solid #ccc;
      height: 26px;
      text-align: center;
      vertical-align: middle;
      font-size: 10px;
    }
    /* Primera fila con datos propuestos */
    .prop-data {
      background: #fffbe6;
      font-size: 10px;
      color: #555;
      text-align: left;
      padding-left: 8px;
      font-style: italic;
    }

    /* Separador entre ejercicios */
    .sep-row td {
      height: 5px;
      border: none;
      background: transparent;
    }

    /* Parte final */
    .parte-final-row td { border: 1px solid #999; }
    .parte-final-cell {
      background: #111; color: #fff;
      font-size: 10px; font-weight: 800;
      padding: 4px 8px;
      letter-spacing: 1px;
      text-align: left;
    }

    /* Anchos de columnas alternados */
    .col-series  { width: 44px; }
    .col-angosta { width: 28px; }   /* impares: número de repeticiones */
    .col-ancha   { width: 62px; }   /* pares: espacio para escribir     */

    /* Fila única del complemento */
    .comp-single-row td { border: 1px solid #ccc; }
    .comp-single-cell   { height: 26px; }

    /* ── Print ── */
    @media print {
      body { padding: 4px 8px; }
      @page { size: A4 portrait; margin: 8mm; }
      .plan-block { page-break-inside: avoid; }
    }
  </style>
</head>
<body>
  <div class="header-planilla">
    <div class="alumno-nombre">${alumno.nombre}</div>
    <div class="header-right">
      <div class="ciclo-badge">Ciclo ${propuesta.numero_ciclo_nuevo}</div>
      <div class="fecha-txt">Fecha: ${fechaStr}</div>
    </div>
  </div>

  ${planesHTML}

  <script>
    window.onload = () => window.print();
  <\/script>
</body>
</html>`;

  const win = window.open('', '_blank');
  if (!win) {
    toast('El navegador bloqueó la ventana emergente. Permitila para imprimir.', 'error');
    return;
  }
  win.document.open();
  win.document.write(html);
  win.document.close();
}

// ── Pantalla 6: Confirmación ──────────────────────────────────────────────────
function renderConfirmacion(container, { titulo, mensaje, resumen = [], alumnoId }) {
  const resumenHTML = resumen.map(r => `
    <div class="confirm-resumen-item">
      <span class="ck">${r.k}</span>
      <span class="cv">${r.v}</span>
    </div>`).join('');

  container.innerHTML = `
    <div class="screen active" id="screen-confirm">
      <div class="content">
        <div class="confirm-screen">
          <div class="confirm-icon">✅</div>
          <div class="confirm-title">${titulo}</div>
          <div class="confirm-msg">${mensaje}</div>
          ${resumen.length > 0 ? `<div class="confirm-resumen">${resumenHTML}</div>` : ''}
          ${alumnoId ? `<button class="btn-primary" style="max-width:280px;margin-bottom:10px" id="btn-al-perfil">Ver perfil del alumno</button>` : ''}
          <button class="${alumnoId ? 'btn-secondary' : 'btn-primary'}" style="max-width:280px" id="btn-panel">Volver al panel</button>
        </div>
      </div>
    </div>`;

  if (alumnoId) {
    document.getElementById('btn-al-perfil').onclick = () => navigate('perfil', { id: alumnoId });
  }
  document.getElementById('btn-panel').onclick = () => navigate('panel');
}

// ── Pantalla: Cobranza ────────────────────────────────────────────────────────
async function renderCobranza(container) {
  const hoy = new Date();
  let mesActual = hoy.getMonth() + 1;
  let añoActual = hoy.getFullYear();

  container.innerHTML = `
    <div class="screen active" id="screen-cobranza">
      <div class="header">
        <button class="back-btn" id="btn-back">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M15 18l-6-6 6-6"/></svg>
          Atrás
        </button>
        <div class="header-title">Cobranza</div>
        <div class="header-actions">
          <button class="icon-btn" id="btn-config" title="Configurar CBU/QR">⚙️</button>
        </div>
      </div>
      <div class="content" id="cobranza-body">
        <div class="mes-selector">
          <select class="form-select" id="sel-mes">
            ${['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre']
              .map((m,i) => `<option value="${i+1}" ${i+1 === mesActual ? 'selected' : ''}>${m}</option>`).join('')}
          </select>
          <select class="form-select" id="sel-año" style="width:100px">
            ${[añoActual-1, añoActual, añoActual+1].map(a => `<option ${a === añoActual ? 'selected' : ''}>${a}</option>`).join('')}
          </select>
          <button class="btn-primary" id="btn-buscar" style="width:auto;padding:10px 16px">Buscar</button>
        </div>
        <div style="display:flex;gap:8px;margin-bottom:14px">
          <button class="btn-secondary" id="btn-subir-extracto-top" style="flex:1;padding:11px;font-size:13px;font-weight:600">🏦 Extracto del banco</button>
          <input type="file" id="file-extracto-top" accept=".xlsx,.xls" style="display:none">
          <button class="btn-secondary" id="btn-subir-efectivo" style="flex:1;padding:11px;font-size:13px;font-weight:600">💵 Pagos en efectivo</button>
          <input type="file" id="file-efectivo" accept=".xlsx,.xls" style="display:none">
        </div>
        <div id="cobranza-resultado"></div>
      </div>
    </div>`;

  document.getElementById('btn-back').onclick = () => navigate('panel');
  document.getElementById('btn-config').onclick = () => navigate('configuracion');

  // Botón extracto visible desde el inicio
  const fileExtractoTop = document.getElementById('file-extracto-top');
  document.getElementById('btn-subir-extracto-top').onclick = () => fileExtractoTop.click();
  fileExtractoTop.onchange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const btn = document.getElementById('btn-subir-extracto-top');
    btn.innerHTML = '<span class="spinner" style="border-top-color:var(--text)"></span> Procesando...';
    btn.disabled = true;
    mesActual = parseInt(document.getElementById('sel-mes').value);
    añoActual = parseInt(document.getElementById('sel-año').value);
    try {
      const formData = new FormData();
      formData.append('extracto', file);
      formData.append('mes', mesActual);
      formData.append('año', añoActual);
      formData.append('ano', añoActual);
      const resp = await fetch('/api/cobranza/procesar-extracto', { method: 'POST', body: formData });
      const result = await resp.json();
      if (!resp.ok) throw new Error(result.error);
      toast(result.mensaje, result.procesados > 0 ? 'success' : 'info');
      if (result.no_identificados?.length > 0) mostrarModalNoIdentificados(result.no_identificados);
      cargarCobranza();
    } catch(err) {
      toast(err.message, 'error');
    } finally {
      btn.innerHTML = '🏦 Extracto del banco';
      btn.disabled = false;
      fileExtractoTop.value = '';
    }
  };

  // Botón pagos en efectivo
  const fileEfectivo = document.getElementById('file-efectivo');
  document.getElementById('btn-subir-efectivo').onclick = () => fileEfectivo.click();
  fileEfectivo.onchange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const btn = document.getElementById('btn-subir-efectivo');
    btn.innerHTML = '<span class="spinner" style="border-top-color:var(--text)"></span> Procesando...';
    btn.disabled = true;
    mesActual = parseInt(document.getElementById('sel-mes').value);
    añoActual = parseInt(document.getElementById('sel-año').value);
    try {
      const formData = new FormData();
      formData.append('archivo', file);
      formData.append('mes', mesActual);
      formData.append('ano', añoActual);
      const resp = await fetch('/api/cobranza/importar-efectivo', { method: 'POST', body: formData });
      const result = await resp.json();
      if (!resp.ok) throw new Error(result.error);
      toast(result.mensaje, result.registrados > 0 ? 'success' : 'info');
      if (result.no_encontrados?.length > 0) {
        const nombres = result.no_encontrados.map(x => x.nombre).join(', ');
        toast('Sin coincidencia: ' + nombres, 'warning');
      }
      cargarCobranza();
    } catch(err) {
      toast(err.message, 'error');
    } finally {
      btn.innerHTML = '💵 Pagos en efectivo';
      btn.disabled = false;
      fileEfectivo.value = '';
    }
  };

  async function cargarCobranza() {
    mesActual = parseInt(document.getElementById('sel-mes').value);
    añoActual = parseInt(document.getElementById('sel-año').value);
    const res = document.getElementById('cobranza-resultado');
    res.innerHTML = `<div class="loading-screen" style="height:180px"><div class="spinner" style="border-color:rgba(0,0,0,.15);border-top-color:var(--text)"></div></div>`;
    try {
      const data = await api('GET', `/cobranza/${añoActual}/${mesActual}`);
      renderCobranzaResultado(data, mesActual, añoActual);
    } catch(e) {
      res.innerHTML = `<div class="empty-state"><p>${e.message}</p></div>`;
    }
  }

  document.getElementById('btn-buscar').onclick = cargarCobranza;
  cargarCobranza();
}

function renderCobranzaResultado(data, mes, año) {
  const meses = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];
  const container = document.getElementById('cobranza-resultado');

  container.innerHTML = `
    <div class="cobranza-stats">
      <div class="metric-card">
        <div class="num" style="color:var(--green)">${data.pagaron}</div>
        <div class="lbl">Pagaron</div>
      </div>
      <div class="metric-card">
        <div class="num" style="color:var(--amber)">${data.pendientes}</div>
        <div class="lbl">Pendientes</div>
      </div>
      <div class="metric-card">
        <div class="num" style="font-size:16px;color:var(--green)">$${data.totalCobrado.toLocaleString('es-AR',{maximumFractionDigits:0})}</div>
        <div class="lbl">Cobrado</div>
      </div>
    </div>

    <div style="display:flex;gap:8px;margin-bottom:14px">
      <button class="btn-secondary" id="btn-subir-extracto" style="flex:1;margin-top:0;padding:10px;font-size:13px">📂 Subir extracto Excel</button>
      <button class="btn-secondary" id="btn-ver-qr" style="flex:1;margin-top:0;padding:10px;font-size:13px">📲 Ver QR de pago</button>
    </div>

    <input type="file" id="file-extracto" accept=".xlsx,.xls" style="display:none">

    <div class="section-label">${meses[mes-1]} ${año}</div>
    <div id="lista-pagos">
      ${data.alumnos.map(a => alumnoCobranzaHTML(a)).join('')}
    </div>`;

  // Subir extracto
  const fileInput = document.getElementById('file-extracto');
  document.getElementById('btn-subir-extracto').onclick = () => fileInput.click();
  fileInput.onchange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const btn = document.getElementById('btn-subir-extracto');
    btn.innerHTML = '<span class="spinner" style="border-top-color:var(--text)"></span> Procesando...';
    btn.disabled = true;
    try {
      const formData = new FormData();
      formData.append('extracto', file);
      formData.append('mes', mes);
      formData.append('año', año);
      formData.append('ano', año);
      const res = await fetch('/api/cobranza/procesar-extracto', { method: 'POST', body: formData });
      const result = await res.json();
      if (!res.ok) throw new Error(result.error);

      // Mostrar resultado
      toast(result.mensaje, result.procesados > 0 ? 'success' : 'info');
      if (result.aviso) toast(result.aviso, 'info');

      // Si hubo movimientos no identificados, mostrar modal con detalles
      if (result.noIdentificados && result.noIdentificados.length > 0) {
        mostrarModalNoIdentificados(result.noIdentificados);
      }

      // Recargar lista
      const data2 = await api('GET', `/cobranza/${año}/${mes}`);
      renderCobranzaResultado(data2, mes, año);
    } catch(e) {
      toast(e.message, 'error');
      btn.innerHTML = '📂 Subir extracto Excel';
      btn.disabled = false;
    }
  };

  // Ver QR
  document.getElementById('btn-ver-qr').onclick = () => mostrarModalQR();

  // Botones de pago manual / eliminar
  container.querySelectorAll('.btn-pagar-manual').forEach(btn => {
    btn.onclick = () => mostrarModalPagoManual(parseInt(btn.dataset.id), btn.dataset.nombre, mes, año);
  });
  container.querySelectorAll('.btn-eliminar-pago').forEach(btn => {
    btn.onclick = async () => {
      if (!confirm('¿Eliminar este pago?')) return;
      await api('DELETE', `/pagos/${btn.dataset.pagoId}`);
      toast('Pago eliminado');
      const data2 = await api('GET', `/cobranza/${año}/${mes}`);
      renderCobranzaResultado(data2, mes, año);
    };
  });
}

function alumnoCobranzaHTML(a) {
  const color = a.estado === 'pagado' ? 'green' : 'gray';
  const monto = a.pago?.monto ? `$${Number(a.pago.monto).toLocaleString('es-AR',{maximumFractionDigits:0})}` : '';
  const cuota = a.cuota_mensual ? `$${Number(a.cuota_mensual).toLocaleString('es-AR',{maximumFractionDigits:0})}` : 'Sin cuota';
  const detalle = a.pago
    ? `${a.pago.metodo === 'transferencia' ? '🏦' : '💵'} ${a.pago.fecha_pago || ''}`
    : `Cuota: ${cuota}${a.cuit ? '' : ' · Sin CUIT'}`;
  return `
    <div class="pago-row ${a.estado}">
      <div class="pago-avatar ${color}">${iniciales(a.nombre)}</div>
      <div class="pago-info">
        <div class="pago-nombre">${a.nombre}</div>
        <div class="pago-detalle">${detalle}</div>
      </div>
      ${a.pago ? `<span class="pago-monto">${monto}</span>` : ''}
      <span class="pago-estado ${a.estado}">${a.estado === 'pagado' ? '✓ Pagó' : 'Pendiente'}</span>
      ${a.pago
        ? `<button class="icon-btn btn-eliminar-pago" data-pago-id="${a.pago.id}" style="background:var(--red-bg);color:var(--red);width:30px;height:30px;font-size:13px">✕</button>`
        : `<button class="btn-pagar-manual" data-id="${a.id}" data-nombre="${a.nombre}" style="font-size:12px;font-weight:600;color:var(--blue);padding:6px 10px;border:1px solid var(--blue);border-radius:6px;white-space:nowrap">+ Pago</button>`}
    </div>`;
}

function mostrarModalPagoManual(alumnoId, nombre, mes, año) {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal">
      <div class="modal-drag"></div>
      <div class="modal-title">Registrar pago</div>
      <div class="modal-sub">${nombre}</div>
      <div class="form-group">
        <label class="form-label">Monto ($)</label>
        <input type="number" class="form-input" id="pm-monto" placeholder="ej: 15000">
      </div>
      <div class="form-group">
        <label class="form-label">Medio de pago</label>
        <select class="form-select" id="pm-metodo">
          <option value="efectivo">Efectivo</option>
          <option value="transferencia">Transferencia</option>
          <option value="debito">Débito</option>
          <option value="otro">Otro</option>
        </select>
      </div>
      <div class="form-group">
        <label class="form-label">Fecha</label>
        <input type="date" class="form-input" id="pm-fecha" value="${new Date().toISOString().slice(0,10)}">
      </div>
      <div class="form-group">
        <label class="form-label">Observaciones</label>
        <input type="text" class="form-input" id="pm-obs" placeholder="Opcional">
      </div>
      <button class="btn-primary" id="pm-guardar">Guardar pago</button>
      <button class="btn-secondary" id="pm-cancelar">Cancelar</button>
    </div>`;
  document.body.appendChild(overlay);
  overlay.querySelector('#pm-cancelar').onclick = () => overlay.remove();
  overlay.onclick = e => { if (e.target === overlay) overlay.remove(); };
    overlay.querySelector('#pm-guardar').onclick = async () => {
    const monto = parseFloat(overlay.querySelector('#pm-monto').value);
    if (!monto) { toast('Ingresa el monto', 'error'); return; }
    const btn = overlay.querySelector('#pm-guardar');
    btn.disabled = true; btn.textContent = 'Guardando...';
    try {
      await api('POST', '/pagos', {
        alumno_id: alumnoId, mes, ano: ano,
        monto,
        fecha_pago: overlay.querySelector('#pm-fecha').value,
        metodo: overlay.querySelector('#pm-metodo').value,
        observaciones: overlay.querySelector('#pm-obs').value
      });
      overlay.remove();
      toast('Pago registrado', 'success');
      const data = await api('GET', '/cobranza/' + ano + '/' + mes);
      renderCobranzaResultado(data, mes, ano);
    } catch(e) {
      toast(e.message, 'error');
      btn.disabled = false; btn.textContent = 'Guardar pago';
    }
  };
}

function mostrarModalNoIdentificados(items) {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  const filas = items.map(item => `
    <tr style="border-bottom:1px solid var(--border)">
      <td style="padding:6px 8px;font-size:12px;font-family:monospace">${item.cuit}</td>
      <td style="padding:6px 8px;font-size:12px;font-weight:600">${item.dni || '—'}</td>
      <td style="padding:6px 8px;font-size:12px;color:var(--text2)">${item.concepto}</td>
      <td style="padding:6px 8px;font-size:12px;text-align:right">$${Number(item.importe).toLocaleString('es-AR')}</td>
    </tr>`).join('');

  overlay.innerHTML = `
    <div class="modal" style="max-width:540px">
      <div class="modal-drag"></div>
      <div class="modal-title">Movimientos sin identificar</div>
      <p style="font-size:13px;color:var(--text2);margin-bottom:14px;line-height:1.5">
        Estos movimientos tienen un CUIT en el extracto pero no coinciden con ningún alumno.
        Pueden ser pagos de familiares u otras personas. Revisalos y registralos manualmente si corresponde.
      </p>
      <div style="overflow-x:auto;margin-bottom:16px">
        <table style="width:100%;border-collapse:collapse">
          <thead>
            <tr style="background:var(--bg2,#eee)">
              <th style="padding:6px 8px;font-size:11px;text-align:left">CUIT</th>
              <th style="padding:6px 8px;font-size:11px;text-align:left">DNI extraído</th>
              <th style="padding:6px 8px;font-size:11px;text-align:left">Concepto</th>
              <th style="padding:6px 8px;font-size:11px;text-align:right">Monto</th>
            </tr>
          </thead>
          <tbody>${filas}</tbody>
        </table>
      </div>
      <p style="font-size:12px;color:var(--text3);margin-bottom:12px">
        Tip: si reconocés a alguien, cargale el DNI en su perfil y la próxima vez se detecta solo.
      </p>
      <button class="btn-secondary" id="noid-cerrar">Cerrar</button>
    </div>`;

  document.body.appendChild(overlay);
  overlay.querySelector('#noid-cerrar').onclick = () => overlay.remove();
  overlay.onclick = e => { if (e.target === overlay) overlay.remove(); };
}

function mostrarModalQR(mes, ano) {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal">
      <div class="modal-drag"></div>
      <div class="modal-title">QR de pago</div>
      <div id="qr-container" style="text-align:center;padding:16px">
        <div class="spinner" style="margin:0 auto"></div>
      </div>
      <button class="btn-secondary" id="qr-cerrar">Cerrar</button>
    </div>`;
  document.body.appendChild(overlay);
  overlay.querySelector('#qr-cerrar').onclick = () => overlay.remove();
  overlay.onclick = e => { if (e.target === overlay) overlay.remove(); };
  api('GET', '/cobranza/qr').then(data => {
    const c = overlay.querySelector('#qr-container');
    c.innerHTML = '<img src="' + data.qr + '" style="max-width:220px;border-radius:8px"><p style="font-size:12px;color:var(--text2);margin-top:8px">' + data.texto + '</p>';
  }).catch(e => {
    const c = overlay.querySelector('#qr-container');
    c.innerHTML = '<p style="color:#c62828">' + e.message + '<br><small>Configura CBU/alias en Configuracion primero</small></p>';
  });
}

// -- Pantalla: Configuracion --------------------------------------------------
async function renderConfiguracion(container) {
  const [cfg, actividades] = await Promise.all([
    api('GET', '/configuracion').catch(() => ({})),
    api('GET', '/actividades').catch(() => [])
  ]);

  container.innerHTML = `
    <div class="screen active" id="screen-config">
      <div class="header">
        <button class="back-btn" id="btn-back">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M15 18l-6-6 6-6"/></svg>
          Atras
        </button>
        <div class="header-title">Configuracion</div>
      </div>
      <div class="screen-body" style="padding:16px;max-width:520px;margin:0 auto">

        <div class="card" style="margin-bottom:16px">
          <div class="section-label" style="margin-bottom:12px">Datos del gimnasio</div>
          <div class="form-group">
            <label class="form-label">Nombre del gimnasio / titular</label>
            <input class="form-input" id="cfg-titular" placeholder="Ej: Voltage Training" value="">
          </div>
        </div>

        <div class="card" style="margin-bottom:16px">
          <div class="section-label" style="margin-bottom:4px">Actividades y tarifas</div>
          <p style="font-size:12px;color:var(--text3);margin-bottom:12px">Definí las actividades con sus precios. Cada alumno puede tener una asignada.</p>
          <div id="lista-actividades">
            ${actividades.map(a => `
              <div class="actividad-row" data-id="${a.id}">
                <input class="form-input act-nombre" value="${a.nombre}" placeholder="Ej: Musculacion" style="flex:1;margin:0">
                <span style="padding:0 6px;color:var(--text3);font-size:13px">$</span>
                <input class="form-input act-cuota" type="number" value="${a.cuota}" placeholder="0" style="width:110px;margin:0">
                <span style="font-size:11px;color:var(--text3);white-space:nowrap">${a.alumnos_count} alumno${a.alumnos_count !== 1 ? 's' : ''}</span>
                <button class="icon-btn btn-guardar-act" title="Guardar" style="color:var(--accent-dark)">✓</button>
                <button class="icon-btn btn-borrar-act" title="Eliminar" style="color:var(--red)">✕</button>
              </div>`).join('')}
          </div>
          <div style="display:flex;gap:8px;margin-top:10px">
            <input class="form-input" id="nueva-act-nombre" placeholder="Nueva actividad..." style="flex:1;margin:0">
            <span style="padding:0 6px;color:var(--text3);font-size:13px;line-height:42px">$</span>
            <input class="form-input" id="nueva-act-cuota" type="number" placeholder="0" style="width:110px;margin:0">
            <button class="btn-primary" id="btn-nueva-act" style="width:auto;padding:10px 14px;white-space:nowrap">+ Agregar</button>
          </div>
        </div>

        <div class="card" style="margin-bottom:16px">
          <div class="section-label" style="margin-bottom:12px">Pagos por QR / transferencia</div>
          <div class="form-group">
            <label class="form-label">CBU o alias</label>
            <input class="form-input" id="cfg-cbu" placeholder="Ej: voltage.training o 0000003100..." value="">
          </div>
          <div class="form-group">
            <label class="form-label">Texto para el QR (opcional)</label>
            <input class="form-input" id="cfg-qr-texto" placeholder="Ej: Cuota mensual Voltage Training" value="">
          </div>
        </div>

        <div class="card" style="margin-bottom:16px">
          <div class="section-label" style="margin-bottom:12px">Integracion con IA (opcional)</div>
          <p style="font-size:13px;color:var(--text2);margin-bottom:10px">
            Con una API key de Anthropic, Claude genera propuestas de nuevos ciclos personalizadas.
          </p>
          <div class="form-group">
            <label class="form-label">API Key de Anthropic</label>
            <input class="form-input" id="cfg-apikey" type="password" placeholder="sk-ant-..." value="" autocomplete="off">
          </div>
        </div>

        <button class="btn-primary" id="btn-guardar-cfg" style="width:100%;padding:13px;font-size:15px">
          Guardar configuracion
        </button>
        <p id="cfg-msg" style="text-align:center;font-size:13px;margin-top:10px;min-height:18px"></p>
      </div>
    </div>`;

  document.getElementById('btn-back').onclick = () => navigate('panel');

  if (cfg.titular)   document.getElementById('cfg-titular').value   = cfg.titular;
  if (cfg.cbu)       document.getElementById('cfg-cbu').value       = cfg.cbu;
  if (cfg.qr_texto)  document.getElementById('cfg-qr-texto').value  = cfg.qr_texto;

  // ── Actividades ──
  function bindActividadRows() {
    document.querySelectorAll('.btn-guardar-act').forEach(btn => {
      btn.onclick = async () => {
        const row = btn.closest('.actividad-row');
        const id = row.dataset.id;
        const nombre = row.querySelector('.act-nombre').value.trim();
        const cuota = parseFloat(row.querySelector('.act-cuota').value) || 0;
        if (!nombre) return;
        // Preguntar si actualiza alumnos
        const count = parseInt(row.querySelector('span:nth-child(4)').textContent);
        let actualizarAlumnos = false;
        if (count > 0) {
          actualizarAlumnos = confirm(`¿Actualizar la cuota de los ${count} alumno${count !== 1 ? 's' : ''} que tienen esta actividad a $${cuota.toLocaleString('es-AR')}?`);
        }
        await api('PUT', `/actividades/${id}`, { nombre, cuota, actualizar_alumnos: actualizarAlumnos });
        toast('Actividad guardada', 'success');
        renderConfiguracion(container);
      };
    });
    document.querySelectorAll('.btn-borrar-act').forEach(btn => {
      btn.onclick = async () => {
        const row = btn.closest('.actividad-row');
        const nombre = row.querySelector('.act-nombre').value;
        if (!confirm(`¿Eliminar la actividad "${nombre}"? Los alumnos quedarán sin actividad asignada.`)) return;
        await api('DELETE', `/actividades/${row.dataset.id}`);
        toast('Actividad eliminada');
        renderConfiguracion(container);
      };
    });
  }
  bindActividadRows();

  document.getElementById('btn-nueva-act').onclick = async () => {
    const nombre = document.getElementById('nueva-act-nombre').value.trim();
    const cuota = parseFloat(document.getElementById('nueva-act-cuota').value) || 0;
    if (!nombre) { toast('Ingresá un nombre para la actividad', 'error'); return; }
    await api('POST', '/actividades', { nombre, cuota });
    toast('Actividad creada', 'success');
    renderConfiguracion(container);
  };

  // ── Config general ──
  document.getElementById('btn-guardar-cfg').onclick = async () => {
    const btn = document.getElementById('btn-guardar-cfg');
    const msg = document.getElementById('cfg-msg');
    btn.disabled = true; btn.textContent = 'Guardando...';
    try {
      const body = {
        titular:  document.getElementById('cfg-titular').value.trim(),
        cbu:      document.getElementById('cfg-cbu').value.trim(),
        qr_texto: document.getElementById('cfg-qr-texto').value.trim(),
      };
      const apiKey = document.getElementById('cfg-apikey').value.trim();
      if (apiKey) body.api_key = apiKey;
      await api('POST', '/configuracion', body);
      msg.style.color = 'var(--accent-dark)';
      msg.textContent = '✓ Configuracion guardada';
      setTimeout(() => { msg.textContent = ''; }, 3000);
    } catch(e) {
      msg.style.color = '#c62828';
      msg.textContent = 'Error: ' + e.message;
    } finally {
      btn.disabled = false; btn.textContent = 'Guardar configuracion';
    }
  };
}

renderApp();
