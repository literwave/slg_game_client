const assert = require('assert');
const fs = require('fs');
const path = require('path');
const ts = require(process.argv[2] || 'typescript');

const ROOT = path.resolve(__dirname, '../..');

function loadTs(relPath) {
    const file = path.join(ROOT, relPath);
    const source = fs.readFileSync(file, 'utf8');
    const output = ts.transpileModule(source, {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
    });
    const mod = { exports: {} };
    const fn = new Function('exports', 'require', 'module', output.outputText);
    fn(mod.exports, require, mod);
    return mod.exports;
}

const layout = loadTs('assets/scripts/city/InnerCityLayout.ts');
const buildingDetails = JSON.parse(fs.readFileSync(path.join(ROOT, 'assets/resources/config/BuildingDetail.json'), 'utf8'));

let passed = 0;
function test(name, fn) {
    fn();
    passed++;
    console.log(`  PASS: ${name}`);
}

console.log('Running InnerCityScene regression tests...');

test('all 16 buildings from BuildingDetail.json have unique inner-city plots and existing sprite assets', () => {
    const ids = buildingDetails.map(row => row.Id).sort((a, b) => a - b);
    const plotIds = layout.INNER_CITY_PLOTS.map(p => p.type).sort((a, b) => a - b);
    assert.deepStrictEqual(plotIds, ids, 'every BuildingDetail ID must have a matching plot');

    const groundPath = path.join(ROOT, 'assets/resources', `${layout.INNER_CITY_GROUND_ART}.jpg`);
    assert.ok(fs.existsSync(groundPath), `panoramic ground map missing: ${groundPath}`);
    assert.ok(fs.existsSync(`${groundPath}.meta`), 'panoramic ground map meta missing');

    const foundationPath = path.join(ROOT, 'assets/resources', `${layout.INNER_CITY_PLOT_FOUNDATION_ART}.png`);
    const lockedPath = path.join(ROOT, 'assets/resources', `${layout.INNER_CITY_PLOT_LOCKED_ART}.png`);
    assert.ok(fs.existsSync(foundationPath), `buildable foundation plot missing: ${foundationPath}`);
    assert.ok(fs.existsSync(lockedPath), `locked plot missing: ${lockedPath}`);

    for (const spec of layout.INNER_CITY_PLOTS) {
        assert.ok(spec.nx >= -0.48 && spec.nx <= 0.48, `plot ${spec.type} nx out of bounds: ${spec.nx}`);
        assert.ok(spec.ny >= -0.45 && spec.ny <= 0.45, `plot ${spec.type} ny out of bounds: ${spec.ny}`);
        const artPath = path.join(ROOT, 'assets/resources', `${spec.art}.png`);
        assert.ok(fs.existsSync(artPath), `building sprite missing for ${spec.type}: ${artPath}`);
    }
});

test('plots do not stack on top of each other in canvas coordinates', () => {
    const positions = layout.INNER_CITY_PLOTS.map(spec => ({
        spec,
        pos: layout.plotCanvasPosition(spec),
    }));
    for (let i = 0; i < positions.length; i++) {
        for (let j = i + 1; j < positions.length; j++) {
            const a = positions[i];
            const b = positions[j];
            const dist = Math.hypot(a.pos.x - b.pos.x, a.pos.y - b.pos.y);
            assert.ok(dist >= 220, `plots ${a.spec.type} (${a.spec.fallbackName}) and ${b.spec.type} (${b.spec.fallbackName}) are too close: ${dist.toFixed(1)}px`);
        }
    }
});

test('depth sorting orders northern buildings before southern buildings', () => {
    const sorted = layout.sortedPlotOrder();
    assert.strictEqual(sorted.length, 16);
    for (let i = 1; i < sorted.length; i++) {
        assert.ok(sorted[i - 1].ny >= sorted[i].ny, 'plots must be sorted back-to-front (descending ny)');
    }
    assert.strictEqual(sorted[0].type, 1, 'Main City sits at the northernmost ceremonial terrace');
    assert.strictEqual(sorted[sorted.length - 1].type, 10, 'Farm sits at the southernmost riverside meadow');
});

test('camera clamping prevents exposing black borders at any zoom level', () => {
    const minZoom = layout.computeMinZoom(1280, 720);
    assert.ok(minZoom >= layout.INNER_CITY_MIN_ZOOM && minZoom <= layout.INNER_CITY_MAX_ZOOM);

    const clampedFar = layout.clampCameraOffset(9999, -9999, 0.9, 1280, 720);
    const maxX = (layout.INNER_CITY_CANVAS_WIDTH * 0.9 - 1280) * 0.5;
    const maxY = (layout.INNER_CITY_CANVAS_HEIGHT * 0.9 - 720) * 0.5;
    assert.ok(Math.abs(clampedFar.x - maxX) < 0.01);
    assert.ok(Math.abs(clampedFar.y + maxY) < 0.01);
});

test('focus pan shifts selected building clear of the right-side detail drawer', () => {
    const mainSpec = layout.findInnerCityPlot(1);
    assert.ok(mainSpec);
    const withoutDrawer = layout.computeFocusPan(mainSpec, 0.9, 1280, 720, 0);
    const withDrawer = layout.computeFocusPan(mainSpec, 0.9, 1280, 720, 344);
    assert.ok(withDrawer.x < withoutDrawer.x, 'when right drawer is open, camera should shift building leftward');
});

test('Main.ts, MapUILogic.ts, MapClickUILogic.ts, and GuideOverlay.ts wire InnerCityScene cleanly', () => {
    const mainSrc = fs.readFileSync(path.join(ROOT, 'assets/scripts/Main.ts'), 'utf8');
    const mapUiSrc = fs.readFileSync(path.join(ROOT, 'assets/scripts/map/ui/MapUILogic.ts'), 'utf8');
    const clickSrc = fs.readFileSync(path.join(ROOT, 'assets/scripts/map/MapClickUILogic.ts'), 'utf8');
    const guideSrc = fs.readFileSync(path.join(ROOT, 'assets/scripts/map/ui/GuideOverlay.ts'), 'utf8');

    assert.ok(mainSrc.includes('LogicEvent.enterInnerCity') && mainSrc.includes('LogicEvent.exitInnerCity'));
    assert.ok(mainSrc.includes('this._mapScene.active = false') && mainSrc.includes('this._mapScene.active = true'));
    assert.ok(mainSrc.includes('myIndex > uiIndex') && mainSrc.includes('uiIndex - 1'),
        'Main.ts must keep InnerCityScene strictly below MapUIScene across repeated enter/exit cycles so top ResourceBar never disappears');
    assert.ok(mapUiSrc.includes('onInnerCityStateChanged') && mapUiSrc.includes('LogicEvent.enterInnerCity'));
    assert.ok(mapUiSrc.includes('RightInfoNodeLogic') && mapUiSrc.includes('setSidebarVisible'),
        'MapUILogic must hide both RightInfoNodeLogic panel and its collapse handle inside InnerCity');
    assert.ok(clickSrc.includes('LogicEvent.enterInnerCity'));
    assert.ok(guideSrc.includes('InnerCityScene') && guideSrc.includes('getGuideBuildActionNode') && guideSrc.includes('getGuideExitButtonNode'));
});

test('InnerCityScene & InnerCityDetailDrawer guard duplicate UITransform and bind full-viewport pan/zoom', () => {
    const sceneSrc = fs.readFileSync(path.join(ROOT, 'assets/scripts/city/InnerCityScene.ts'), 'utf8');
    const drawerSrc = fs.readFileSync(path.join(ROOT, 'assets/scripts/city/InnerCityDetailDrawer.ts'), 'utf8');

    assert.ok(!/^\s*this\.node\.addComponent\(UITransform\)/m.test(drawerSrc),
        'InnerCityDetailDrawer must not unconditionally addComponent(UITransform) on a node that already has one');
    assert.ok(drawerSrc.includes('!this.node.getComponent(UITransform)'),
        'InnerCityDetailDrawer must check getComponent(UITransform) before addComponent');
    assert.ok(sceneSrc.includes('vpUi.setContentSize(viewW, viewH)'),
        'InnerCityScene must explicitly size viewportNode to match the full viewport for reliable touch panning');
    assert.ok(sceneSrc.includes('Node.EventType.TOUCH_START')
        && sceneSrc.includes('Node.EventType.TOUCH_MOVE')
        && sceneSrc.includes('Node.EventType.MOUSE_WHEEL'),
        'InnerCityScene must bind touch drag and mouse wheel zoom events');

    const initZoom = layout.computeInitialZoom(1280, 720);
    const minZoom = layout.computeMinZoom(1280, 720);
    assert.ok(initZoom >= minZoom && initZoom <= layout.INNER_CITY_MAX_ZOOM, 'initial zoom must lie within valid bounds');
});

test('InnerCityConstructionFx provides hammer strike, scaffolding, and completion burst wired to build flow', () => {
    const fxSrc = fs.readFileSync(path.join(ROOT, 'assets/scripts/city/InnerCityConstructionFx.ts'), 'utf8');
    const slotSrc = fs.readFileSync(path.join(ROOT, 'assets/scripts/city/InnerCityBuildingSlot.ts'), 'utf8');
    const drawerSrc = fs.readFileSync(path.join(ROOT, 'assets/scripts/city/InnerCityDetailDrawer.ts'), 'utf8');
    const sceneSrc = fs.readFileSync(path.join(ROOT, 'assets/scripts/city/InnerCityScene.ts'), 'utf8');

    assert.ok(fxSrc.includes('drawArtisanHammer') && fxSrc.includes('drawScaffolding') && fxSrc.includes('drawIdleHammerBadge'),
        'InnerCityConstructionFx must render artisan hammer, scaffolding, and buildable idle hammer badge');
    assert.ok(fxSrc.includes('beginConstruction') && fxSrc.includes('finishConstruction') && fxSrc.includes('triggerHammerStrike'),
        'InnerCityConstructionFx must drive multi-strike hammer construction lifecycle');
    assert.ok(fxSrc.includes('buildHammerSquad') && fxSrc.includes('MultiHammerSquad'),
        'InnerCityConstructionFx must animate multiple artisan hammers hammering together');
    assert.ok(slotSrc.includes('InnerCityConstructionFx') && slotSrc.includes('footprintMetrics') && slotSrc.includes('playConstructionUpgrade'),
        'InnerCityBuildingSlot must ground 2:1 isometric footprint highlight and host InnerCityConstructionFx');
    assert.ok(slotSrc.includes('syncPlaqueScreenPosition') && sceneSrc.includes('PlaqueOverlayLayer'),
        'InnerCityScene must render crisp 1:1 screen-space building plaques in PlaqueOverlayLayer');
    assert.ok(drawerSrc.includes('onBuildStarted'),
        'InnerCityDetailDrawer must emit onBuildStarted immediately when player triggers build/upgrade');
    assert.ok(sceneSrc.includes('onBuildStarted') && sceneSrc.includes('playConstructionUpgrade'),
        'InnerCityScene must connect build clicks and server upgrades to hammer construction FX');
    assert.ok(sceneSrc.includes('InnerCityActionBar') && sceneSrc.includes('actionBarOpen'),
        'InnerCityScene must use SLG floating InnerCityActionBar on building tap instead of forcing right sidebar open');

    // Verify every relative import across assets/scripts/city/*.ts resolves to a real .ts file
    const cityDir = path.join(ROOT, 'assets/scripts/city');
    for (const file of fs.readdirSync(cityDir).filter(f => f.endsWith('.ts'))) {
        const full = path.join(cityDir, file);
        const src = fs.readFileSync(full, 'utf8');
        const re = /from\s+['"](\.[^'"]+)['"]/g;
        let match;
        while ((match = re.exec(src))) {
            const target = path.resolve(cityDir, `${match[1]}.ts`);
            assert.ok(fs.existsSync(target), `${file} has broken relative import "${match[1]}" (missing ${target})`);
        }
    }
});

test('MapTaskTracker supports collapsing to the left screen edge via CollapseTab handle', () => {
    const src = fs.readFileSync(path.join(ROOT, 'assets/scripts/map/ui/MapTaskTracker.ts'), 'utf8');
    assert.ok(src.includes("this.make('CollapseTab')") && src.includes('toggleCollapse') && src.includes('setCollapsed'),
        'MapTaskTracker must create CollapseTab handle and expose toggleCollapse / setCollapsed');
    assert.ok(src.includes('this.collapsedX = -this.viewWidth / 2 - this.width / 2'),
        'MapTaskTracker must slide card body completely off the left screen edge when collapsed');
    assert.ok(src.includes('refreshCollapseHandle') && src.includes('collapseReadyDot'),
        'MapTaskTracker must update handle arrow/label and show claimable ready indicator when collapsed');
});

console.log(`All ${passed}/${passed} InnerCityScene regression tests passed.`);
