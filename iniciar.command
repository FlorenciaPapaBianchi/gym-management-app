#!/bin/bash
# Ir a la carpeta donde está este archivo
cd "$(dirname "$0")"

echo ""
echo "================================================"
echo "   App Rutinas Gimnasio"
echo "================================================"
echo ""

# Verificar que Node.js esté instalado
if ! command -v node &> /dev/null; then
  echo "❌ Node.js no está instalado."
  echo "   Bajalo de https://nodejs.org (versión LTS)"
  echo ""
  read -p "Presioná Enter para cerrar..."
  exit 1
fi

echo "✅ Node.js: $(node --version)"
echo ""
echo "📦 Instalando/verificando dependencias..."
npm install --silent
echo "✅ Dependencias listas"
echo ""
echo "🚀 Iniciando servidor..."
echo "   Para cerrar la app, cerrá esta ventana."
echo ""

# Abrir el navegador después de 2 segundos
(sleep 2 && open http://localhost:3000) &

node server.js
