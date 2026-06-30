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
| Python | Lógica de la aplicación |
| SQLite | Base de datos |

## 📁 Estructura del proyecto

```
gym-management-app/
├── README.md
├── main.py              # Punto de entrada
├── database/
│   └── gym.db          # Base de datos SQLite
├── models/             # Modelos de datos
└── utils/              # Funciones auxiliares
```

## 🚀 Cómo ejecutar

```bash
# Clonar el repositorio
git clone https://github.com/FlorenciaPapaBianchi/gym-management-app.git
cd gym-management-app

# Instalar dependencias
pip install -r requirements.txt

# Ejecutar
python main.py
```

## 📌 Estado del proyecto

✅ En producción / uso activo
