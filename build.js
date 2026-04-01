#!/usr/bin/env node

/**
 * Script de Build para Cache Busting
 * Actualiza automáticamente las versiones de archivos CSS y JS
 * para forzar a los navegadores a descargar las versiones más recientes
 */

const fs = require('fs');
const path = require('path');

// Generar timestamp único para esta build
const version = Date.now();

console.log('🔨 Iniciando build...');
console.log(`📅 Versión: ${version}`);

// Archivos a procesar
const htmlFiles = ['index.html', 'fuentes.html'];

// Función para actualizar las referencias en archivos HTML
function updateHtmlFile(filename) {
    const filePath = path.join(__dirname, filename);

    if (!fs.existsSync(filePath)) {
        console.log(`⚠️  Archivo ${filename} no encontrado, saltando...`);
        return;
    }

    let content = fs.readFileSync(filePath, 'utf8');
    let modified = false;

    // Actualizar referencias a CSS
    const cssRegex = /(href="style\.css)(\?v=\d+)?(")/;
    const cssMatch = content.match(cssRegex);
    if (cssMatch) {
        content = content.replace(cssRegex, `$1?v=${version}$3`);
        modified = true;
        console.log(`  ✓ CSS actualizado en ${filename}`);
    }

    // Actualizar referencias a JS
    const jsRegex = /(src="app\.js)(\?v=\d+)?(")/;
    const jsMatch = content.match(jsRegex);
    if (jsMatch) {
        content = content.replace(jsRegex, `$1?v=${version}$3`);
        modified = true;
        console.log(`  ✓ JS actualizado en ${filename}`);
    }

    if (modified) {
        fs.writeFileSync(filePath, content, 'utf8');
        console.log(`✅ ${filename} actualizado`);
    } else {
        console.log(`ℹ️  ${filename} sin cambios`);
    }
}

// Procesar todos los archivos HTML
htmlFiles.forEach(updateHtmlFile);

console.log('\n✨ Build completado exitosamente!');
console.log(`📝 Versión de caché: ${version}`);
console.log('\n💡 Tip: Ejecuta "node build.js" antes de cada deploy a Hostinger\n');
