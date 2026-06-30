# Guía de instalación — App Rutinas Gimnasio
### Para la PC del gimnasio (Windows) — desde cero

---

## QUÉ HACE ESTA APP

- **Panel de alumnos**: lista de todos los alumnos, estado de rutina y pagos
- **Perfil por alumno**: datos personales, físicos, historial de rutinas
- **Importar Alumnos.xlsx**: subís tu planilla Excel y se actualiza la base de datos automáticamente
- **Cobranza mensual**: subís el extracto de Cuenta DNI y el sistema cruza los CUITs para marcar quién pagó
- **Escáner de rutinas con IA**: sacás foto a una planilla escrita a mano y la app la carga sola (requiere API key)

---

## PASO 1 — Instalar Node.js

1. Abrí el navegador y entrá a: **https://nodejs.org**
2. Hacé clic en el botón grande que dice **"LTS"** (la versión recomendada)
3. Descargá el instalador `.msi` y ejecutalo
4. Aceptá todo con "Next" → "Next" → "Install" → "Finish"
5. **Para verificar que se instaló bien:**
   - Apretá `Windows + R`, escribí `cmd` y apretá Enter
   - En la ventana negra escribí: `node --version`
   - Tiene que aparecer algo como `v22.x.x` (cualquier número 22 o mayor está bien)

---

## PASO 2 — Copiar la carpeta del proyecto

1. Copiá la carpeta **"Creación app rutinas"** a la PC del gimnasio
   - Podés pasarla por pendrive, por Google Drive, o por WhatsApp/Telegram (comprimida en .zip)
2. Guardala en un lugar fácil de encontrar, por ejemplo: `C:\App_Gim\Creación app rutinas`
3. Asegurate de que adentro de la carpeta estén estos archivos:
   ```
   server.js
   package.json
   public/
     index.html
     app.js
     style.css
   ```

---

## PASO 3 — Instalar los paquetes necesarios

1. Abrí la carpeta del proyecto en el Explorador de Windows
2. Hacé clic en la barra de direcciones (arriba, donde dice la ruta)
3. Borrá lo que dice y escribí `cmd`, apretá Enter — se abre una ventana negra ya posicionada en la carpeta
4. Escribí este comando y apretá Enter:
   ```
   npm install
   ```
5. Esperá que termine (puede tardar 1-2 minutos, van a aparecer varios mensajes)
6. Cuando termine vas a ver algo como `added 120 packages` — eso está bien

> **Si aparece error de "scripts deshabilitados"**, usá este comando en lugar del anterior:
> ```
> npm.cmd install
> ```

---

## PASO 4 — Iniciar la app

En la misma ventana negra (cmd), escribí:
```
node server.js
```

Vas a ver un mensaje como:
```
App corriendo en http://localhost:3000
```

**Eso significa que la app está funcionando.**

---

## PASO 5 — Abrir en el navegador

1. Abrí Chrome o Edge
2. En la barra de direcciones escribí: **http://localhost:3000**
3. Apretá Enter
4. Vas a ver el panel de alumnos con los datos de ejemplo (Flor, Moni, Baru)

---

## PASO 6 — Importar tus alumnos desde Excel

1. Preparás el archivo **Alumnos.xlsx** con estas columnas (los nombres exactos no importan, la app los detecta):
   - `N° Orden` · `DNI` · `Apellido y Nombre` · `Fecha Inicio` · `CUIT` · `Monto` · `Peso` · `Altura` · `Edad` · `Objetivos`
2. En el panel principal, tocás el botón 📥 (esquina superior derecha)
3. Elegís el archivo Excel y tocás **Importar**
4. La app crea los alumnos nuevos y actualiza los que ya existen

---

## PASO 7 — Configurar datos de pago (para QR)

1. En el panel principal, tocás el botón 💰 → **Configuración**
2. Cargás el alias, CBU y nombre del titular
3. Guardás
4. A partir de ahí podés generar el QR de pago para que los alumnos escaneen

---

## PASO 8 — Usar la cobranza mensual

1. Descargás el extracto bancario desde la app **Cuenta DNI** (Banco Provincia):
   - En la app del banco → Movimientos → Exportar → Excel
2. En la app, tocás 💰 → seleccionás el mes y el año
3. Tocás **Subir extracto del banco**
4. Elegís el archivo Excel descargado
5. La app cruza los CUIT automáticamente y marca quién pagó

> **Nota**: el cruce funciona solo para los alumnos que tengan el CUIT cargado en su perfil. Podés cargarlo editando cada alumno (ícono ✏️ en el perfil).

---

## CÓMO ARRANCAR LA APP CADA VEZ

Cada vez que querés usar la app tenés que:

1. Abrir la carpeta `Creación app rutinas` en el Explorador
2. Clic en la barra de direcciones, escribir `cmd`, Enter
3. Escribir `node server.js`, Enter
4. Abrir Chrome y entrar a **http://localhost:3000**

> **Tip**: podés crear un acceso directo. Creá un archivo llamado `iniciar.bat` dentro de la carpeta con este contenido:
> ```
> @echo off
> node server.js
> ```
> Haciendo doble clic en ese archivo se abre la app directamente.

---

## ACTIVAR EL ESCÁNER CON IA (opcional)

El escáner de planillas escritas a mano usa la API de Anthropic (Claude). Para activarlo:

1. Entrá a **https://console.anthropic.com** y creá una cuenta
2. Generá una API key (clave de acceso)
3. En la carpeta del proyecto, creá un archivo llamado `.env` (sin nombre, solo extensión)
4. Adentro del archivo escribí:
   ```
   ANTHROPIC_API_KEY=sk-ant-XXXXXXXXXX
   ```
   (reemplazando con tu clave real)
5. Reiniciá el servidor (cerrás la ventana cmd y volvés a hacer `node server.js`)

---

## SI ALGO NO FUNCIONA

**La app no abre / dice "No se puede acceder"**
→ Verificá que la ventana cmd esté abierta y diga "App corriendo en http://localhost:3000"
→ El servidor tiene que estar encendido mientras usás la app

**Error al instalar paquetes (npm)**
→ Verificá que Node.js esté instalado: `node --version` en cmd
→ Probá con `npm.cmd install` en lugar de `npm install`

**Los datos no aparecen / base de datos vacía**
→ La primera vez que arranca crea los datos de ejemplo automáticamente
→ Si querés empezar limpio: borrá la carpeta `data` dentro del proyecto y reiniciá

**Necesito ayuda**
→ Podés pedirle a quien te armó la app que te asista por WhatsApp o Cowork

---

*Versión del proyecto: junio 2026*
