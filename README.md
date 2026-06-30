# 🏋️ App de Gestión de Gimnasio

Aplicación desarrollada para agilizar la operativa diaria de un gimnasio: creación de rutinas personalizadas y control de cobranza de socios.

## 🎯 Problema que resuelve

La gestión manual de rutinas y pagos en gimnasios consume tiempo y es propensa a errores. Esta app centraliza ambos procesos, reduciendo la carga administrativa y mejorando el seguimiento de cada socio.

## ✨ Funcionalidades

- **Gestión de rutinas**: creación y asignación de rutinas personalizadas por socio
- **Control de cobranza**: registro y seguimiento del estado de pagos
- **Base de datos local**: almacenamiento con SQLite, sin dependencia de servicios externos

## 🛠️ Tecnologías

| Herramienta | Uso |
|-------------|-----|
| Node.js | Lógica de la aplicación |
| SQLite | Base de datos |

## 📁 Estructura del proyecto

```
gym-management-app/
├── README.md
├── INSTALAR.md          # Guía de instalación
├── server.js            # Punto de entrada
├── package.json
├── public/              # Archivos estáticos (frontend)
├── data/                # Base de datos SQLite (no incluida en el repo)
├── iniciar.bat          # Script de inicio (Windows)
└── iniciar.command      # Script de inicio (Mac)
```

## 🚀 Cómo ejecutar

```bash
# Clonar el repositorio
git clone https://github.com/FlorenciaPapaBianchi/gym-management-app.git
cd gym-management-app

# Instalar dependencias
npm install

# Ejecutar
node server.js
```
### Podés usar el script iniciar.bat (Windows) o iniciar.command (Mac) para iniciar la app directamente

## 📌 Estado del proyecto

✅ En producción / uso activo
