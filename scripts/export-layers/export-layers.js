'use strict';

// =====================================================================
//  Export Layers — Affinity by Canva (Scripting)
//  Exports each top-level layer as a separate file, named after its
//  name in the Layers panel.
//  - Format: any JPEG or PNG export preset (e.g. "JPEG (Best quality)")
//  - Folder: type a path or pick an existing folder
//  - Area: full canvas (document size) or cropped to the layer
//
//  Requirements: scripting enabled, file system access for this script,
//  and a destination inside a folder allowed in
//  Settings > Scripting > File System access.
// =====================================================================

const { app } = require('/application');
const { Document, FileExportOptions, FileExportArea } = require('/document.js');
const { Dialog, DialogResult } = require('/dialog.js');
const { fs } = require('/fs.js');
const { Environment } = require('/environment.js');

// ---------- helpers ----------
function isOk(result) {
    return (result?.value ?? result) == DialogResult.Ok.value;
}

const SEP = (app.userDesktopPath || '').includes('\\') ? '\\' : '/';

function joinPath(dir, name) {
    const clean = dir.replace(/[\\/]+$/, '');
    return clean + SEP + name;
}

function dirName(path) {
    const i = Math.max(path.lastIndexOf('\\'), path.lastIndexOf('/'));
    return i > 0 ? path.slice(0, i) : path;
}

function safeFileName(name) {
    let n = (name || 'layer').replace(/[<>:"/\\|?*\x00-\x1F]/g, '_').trim();
    n = n.replace(/[. ]+$/, '');            // Windows rejects trailing dots/spaces
    return n.length ? n : 'layer';
}

function layerName(node) {
    return node.userDescription || node.description || node.defaultDescription || 'layer';
}

function docBaseName(doc) {
    const t = (doc.title || 'documento').replace(/\.[^.]+$/, '');
    return safeFileName(t);
}

// ---------- main ----------
async function run() {
    const doc = Document.current;
    if (!doc) {
        app.alert('Abre un documento antes de correr el script.', 'Exportar Layers');
        return;
    }

    // Permissions and allowed folders (Settings > Scripting > File System access).
    // Diagnostics only: we don't stop here; any real error surfaces during export.
    let roots = [];
    try { roots = Environment.fileSystemRoots || []; } catch (_) {}
    try { console.log('Permisos: ' + JSON.stringify(Environment.permissions)); } catch (_) {}
    console.log('Carpetas permitidas: ' + (roots.join(' | ') || '(ninguna)'));

    const layers = doc.layers.toArray();
    if (layers.length === 0) {
        app.alert('El documento no tiene layers.', 'Exportar Layers');
        return;
    }

    // JPEG / PNG export presets available in this installation
    const presets = FileExportOptions.allPresetNames
        .filter(n => /jpe?g|png/i.test(n));
    if (presets.length === 0) {
        app.alert('No encontré presets JPEG o PNG de exportación.', 'Exportar Layers');
        return;
    }
    let defaultPreset = presets.findIndex(n => /jpe?g.*best/i.test(n));
    if (defaultPreset < 0) defaultPreset = 0;

    // Initial folder: the first allowed folder from Settings
    const defaultFolder = roots.length ? roots[0] : '';

    const norm = p => p.replace(/\//g, '\\').replace(/\\+$/, '').toLowerCase();
    const isAllowed = p => !roots.length || roots.some(r => {
        const nr = norm(r), np = norm(p);
        return np === nr || np.startsWith(nr + '\\');
    });

    // ---------- dialog ----------
    const dlg = Dialog.create('Exportar Layers');
    dlg.initialWidth = 480;
    const col = dlg.addColumn();

    const gFmt = col.addGroup('Formato');
    const cFormat = gFmt.addComboBox('Preset', presets, defaultPreset);

    const gDest = col.addGroup('Destino');
    const tFolder = gDest.addTextBox('Carpeta', defaultFolder);
    const bPick = gDest.addButton('Elegir carpeta…');
    gDest.addStaticText('', 'Tip: en "Elegir carpeta…" selecciona cualquier archivo dentro de la carpeta deseada. ' +
                            'También puedes escribir una ruta nueva y se intentará crear.');

    const gOpt = col.addGroup('Opciones');
    const cArea = gOpt.addButtonSet('Área', ['Lienzo completo', 'Solo el layer'], 0);
    const sHidden = gOpt.addSwitch('Incluir layers ocultos', true);
    const sPrefix = gOpt.addSwitch('Numerar archivos (01_, 02_ …) en orden del panel', false);

    bPick.onClickHandler = () => {
        try {
            const picked = app.chooseFile();
            const p = typeof picked === 'string' ? picked : (picked?.path ?? '');
            if (p) tFolder.text = dirName(p);
        } catch (e) {
            console.log('chooseFile falló: ' + e);
        }
    };

    if (!isOk(dlg.runModal())) return;

    // ---------- read options ----------
    const presetName = presets[cFormat.selectedIndex];
    const isPng = /png/i.test(presetName);
    const ext = isPng ? '.png' : '.jpg';
    const onlyLayer = cArea.selectedIndex === 1;
    const includeHidden = sHidden.value;
    const numbered = sPrefix.value;

    let folder = (tFolder.text || '').trim().replace(/^"|"$/g, '');
    if (!folder) {
        app.alert('Elige o escribe una carpeta de destino.', 'Exportar Layers');
        return;
    }

    if (!isAllowed(folder)) {
        app.alert('Affinity no deja que los scripts escriban en:\n' + folder +
                  '\n\nCarpetas permitidas:\n' + roots.join('\n') +
                  '\n\nAgrega la carpeta en Settings > Scripting > File System access > Add, ' +
                  'o elige una carpeta dentro de las permitidas.', 'Exportar Layers');
        return;
    }

    // ---------- create folder (if missing) ----------
    // Uses the sync API: the async versions throw NO_ENVIRONMENT in the Script Editor.
    // No-op if the folder exists. On failure we continue; the export will report the error.
    try { fs.createDirectories(folder); } catch (e) { console.log('createDirectories: ' + e); }

    // ---------- export ----------
    // The Layers panel lists the top layer first; doc.layers goes bottom to top.
    const panelOrder = layers.slice().reverse();
    const originalVisibility = layers.map(n => n.isVisible);
    const options = FileExportOptions.createWithPresetName(presetName);

    const usedNames = new Set();
    const ok = [], failed = [];

    try {
        // Hide everything once
        for (const n of layers) if (n.isVisible) doc.setVisible(false, n.selfSelection);

        panelOrder.forEach((node, i) => {
            const wasVisible = originalVisibility[layers.indexOf(node)];
            if (!includeHidden && !wasVisible) return;

            let base = safeFileName(layerName(node));
            if (numbered) base = String(i + 1).padStart(2, '0') + '_' + base;
            let name = base, k = 2;
            while (usedNames.has(name.toLowerCase())) name = base + '_' + (k++);
            usedNames.add(name.toLowerCase());
            const path = joinPath(folder, name + ext);

            try {
                doc.setVisible(true, node.selfSelection);
                const area = onlyLayer
                    ? FileExportArea.createForSelection(node.selfSelection)
                    : FileExportArea.createForWholeDocument();
                const records = doc.export(path, options, area, null);
                const errs = (records?.all || []).filter(r => r.errorMessage);
                if (errs.length) failed.push(name + ': ' + errs[0].errorMessage);
                else ok.push(name + ext);
            } catch (e) {
                failed.push(name + ': ' + e);
            } finally {
                doc.setVisible(false, node.selfSelection);
            }
        });
    } finally {
        // Restore original visibility
        layers.forEach((n, i) => {
            try { doc.setVisible(originalVisibility[i], n.selfSelection); } catch (_) {}
        });
    }

    // ---------- summary ----------
    let msg = 'Exportados ' + ok.length + ' archivo(s) como "' + presetName + '" en:\n' + folder;
    if (failed.length) msg += '\n\nFallaron ' + failed.length + ':\n' + failed.join('\n');
    if (failed.length && !ok.length)
        msg += '\n\nRevisa que la carpeta exista (créala en el Explorador si hace falta) ' +
               'y que esté dentro de las carpetas permitidas en Settings > Scripting.';
    console.log(msg);
    app.alert(msg, 'Exportar Layers');
}

run().catch(e => {
    console.log(e?.stack || String(e));
    app.alert('Error: ' + e, 'Exportar Layers');
});
