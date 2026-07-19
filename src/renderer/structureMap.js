/**
 * Structure Map Module
 * Interactive force-directed graph visualization of project modules
 */

const { ipcRenderer } = require('electron');
const fs = require('fs');
const path = require('path');
const { IPC } = require('../shared/ipcChannels');
const { escapeHtml } = require('./htmlUtils');

let isVisible = false;
let overlay = null;
let simulation = null;
let currentProjectPath = null;
let selectedNode = null;
let currentModule = null;
let isLoadingGitHistory = false;
let currentView = 'graph'; // 'graph' or 'tree'
let currentStructureData = null;

// Module type colors
const MODULE_COLORS = {
  main: '#d4a574',      // Accent - main process
  renderer: '#78a5d4',  // Info blue - renderer process
  shared: '#7cb382',    // Success green - shared modules
  external: '#6b6660'   // Muted - external deps
};

/**
 * Initialize structure map
 */
function init() {
  createOverlay();
}

/**
 * Create overlay element
 */
function createOverlay() {
  overlay = document.createElement('div');
  overlay.id = 'structure-map-overlay';
  overlay.className = 'structure-map-overlay';
  overlay.innerHTML = `
    <div class="structure-map-container">
      <div class="structure-map-header">
        <h2>Project Structure Map</h2>
        <div class="structure-map-controls">
          <div class="structure-map-view-toggle">
            <button class="view-toggle-btn active" data-view="graph" title="Force-directed graph view">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <circle cx="5" cy="12" r="3"></circle>
                <circle cx="19" cy="5" r="3"></circle>
                <circle cx="19" cy="19" r="3"></circle>
                <line x1="8" y1="12" x2="16" y2="6"></line>
                <line x1="8" y1="12" x2="16" y2="18"></line>
              </svg>
              Graph
            </button>
            <button class="view-toggle-btn" data-view="tree" title="Hierarchical tree view">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <rect x="3" y="3" width="7" height="5" rx="1"></rect>
                <rect x="14" y="3" width="7" height="5" rx="1"></rect>
                <rect x="3" y="16" width="7" height="5" rx="1"></rect>
                <rect x="14" y="16" width="7" height="5" rx="1"></rect>
                <line x1="6.5" y1="8" x2="6.5" y2="16"></line>
                <line x1="17.5" y1="8" x2="17.5" y2="16"></line>
                <line x1="6.5" y1="12" x2="17.5" y2="12"></line>
              </svg>
              Tree
            </button>
          </div>
          <div class="structure-map-legend">
            <span class="legend-item"><span class="legend-dot" style="background: ${MODULE_COLORS.main}"></span>Main</span>
            <span class="legend-item"><span class="legend-dot" style="background: ${MODULE_COLORS.renderer}"></span>Renderer</span>
            <span class="legend-item"><span class="legend-dot" style="background: ${MODULE_COLORS.shared}"></span>Shared</span>
          </div>
          <button class="structure-map-close" title="Close (Esc)">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <line x1="18" y1="6" x2="6" y2="18"></line>
              <line x1="6" y1="6" x2="18" y2="18"></line>
            </svg>
          </button>
        </div>
      </div>
      <div class="structure-map-canvas">
        <svg id="structure-map-svg"></svg>
      </div>
      <div class="structure-map-info">
        <div class="info-panel-resize-handle" title="Drag to resize"></div>
        <div class="info-panel-content">
          <div class="info-placeholder">Hover over a module to see details</div>
        </div>
      </div>
    </div>
  `;

  document.body.appendChild(overlay);

  // Close button
  overlay.querySelector('.structure-map-close').addEventListener('click', hide);

  // Close on backdrop click
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) hide();
  });

  // Close on Escape
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && isVisible) hide();
  });

  // Setup resize handle
  setupInfoPanelResize();

  // Setup view toggle
  setupViewToggle();
}

/**
 * Setup view toggle buttons
 */
function setupViewToggle() {
  const toggleBtns = overlay.querySelectorAll('.view-toggle-btn');

  toggleBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      const view = btn.dataset.view;
      if (view === currentView) return;

      // Update active state
      toggleBtns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');

      // Switch view
      currentView = view;
      if (currentStructureData) {
        if (view === 'graph') {
          renderGraph(currentStructureData);
        } else {
          renderTreeView(currentStructureData);
        }
      }
    });
  });
}

/**
 * Setup info panel resize functionality
 */
function setupInfoPanelResize() {
  const infoPanel = overlay.querySelector('.structure-map-info');
  const resizeHandle = overlay.querySelector('.info-panel-resize-handle');
  const canvas = overlay.querySelector('.structure-map-canvas');

  if (!resizeHandle || !infoPanel) return;

  let isResizing = false;
  let startY = 0;
  let startHeight = 0;
  const minHeight = 120;
  const maxHeight = 500;

  resizeHandle.addEventListener('mousedown', (e) => {
    isResizing = true;
    startY = e.clientY;
    startHeight = infoPanel.offsetHeight;

    document.body.style.cursor = 'ns-resize';
    document.body.style.userSelect = 'none';

    // Add overlay to prevent iframe/svg interference
    overlay.classList.add('resizing');
  });

  document.addEventListener('mousemove', (e) => {
    if (!isResizing) return;

    const deltaY = startY - e.clientY;
    const newHeight = Math.min(maxHeight, Math.max(minHeight, startHeight + deltaY));

    infoPanel.style.height = `${newHeight}px`;
    infoPanel.style.minHeight = `${newHeight}px`;
    infoPanel.style.maxHeight = `${newHeight}px`;
  });

  document.addEventListener('mouseup', () => {
    if (!isResizing) return;

    isResizing = false;
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
    overlay.classList.remove('resizing');

    // Refit terminals after resize
    if (simulation) {
      simulation.alpha(0.1).restart();
    }
  });
}

/**
 * Show structure map
 */
async function show(projectPath) {
  if (!overlay) createOverlay();

  currentProjectPath = projectPath;
  isVisible = true;
  overlay.classList.add('visible');

  // Load and render structure
  const structureData = await loadStructure(projectPath);
  if (structureData) {
    currentStructureData = structureData;
    if (currentView === 'graph') {
      renderGraph(structureData);
    } else {
      renderTreeView(structureData);
    }
  }
}

/**
 * Hide structure map
 */
function hide() {
  isVisible = false;
  if (overlay) {
    overlay.classList.remove('visible');
  }
  if (simulation) {
    simulation.stop();
  }
}

/**
 * Load structure data
 */
async function loadStructure(projectPath) {
  const structurePath = path.join(projectPath, 'STRUCTURE.json');

  try {
    if (!fs.existsSync(structurePath)) {
      showError('STRUCTURE.json not found');
      return null;
    }

    const data = JSON.parse(fs.readFileSync(structurePath, 'utf8'));
    return data;
  } catch (err) {
    console.error('Error loading structure:', err);
    showError(err.message);
    return null;
  }
}

/**
 * Show error in info panel
 */
function showError(message) {
  const infoPanel = overlay.querySelector('.info-panel-content');
  infoPanel.innerHTML = `<div class="info-error">Error: ${message}</div>`;
}

/**
 * Convert structure data to graph format
 */
function structureToGraph(data) {
  const nodes = [];
  const links = [];
  const nodeMap = new Map();

  // Create nodes from modules
  if (data.modules) {
    for (const [moduleId, moduleData] of Object.entries(data.modules)) {
      // Determine module type based on path
      let type = 'shared';
      if (moduleId.startsWith('main/')) type = 'main';
      else if (moduleId.startsWith('renderer/')) type = 'renderer';
      else if (moduleId.startsWith('shared/')) type = 'shared';

      const node = {
        id: moduleId,
        name: moduleId.split('/').pop(),
        fullName: moduleId,
        type,
        file: moduleData.file,
        description: moduleData.description,
        exports: moduleData.exports || [],
        functions: moduleData.functions || {},
        ipc: moduleData.ipc || {}
      };

      nodes.push(node);
      nodeMap.set(moduleId, node);
    }
  }

  // Create links from dependencies
  if (data.modules) {
    for (const [moduleId, moduleData] of Object.entries(data.modules)) {
      if (moduleData.depends) {
        for (const dep of moduleData.depends) {
          // Only link to internal modules (skip external like 'electron', 'fs', etc)
          // Check various formats the dependency might be in
          let targetId = dep;

          // Try to find the dependency in our modules
          if (!nodeMap.has(targetId)) {
            // Try with main/ prefix
            if (nodeMap.has(`main/${dep}`)) {
              targetId = `main/${dep}`;
            }
            // Try with renderer/ prefix
            else if (nodeMap.has(`renderer/${dep}`)) {
              targetId = `renderer/${dep}`;
            }
            // Try with shared/ prefix
            else if (nodeMap.has(`shared/${dep}`)) {
              targetId = `shared/${dep}`;
            }
          }

          if (nodeMap.has(targetId)) {
            links.push({
              source: moduleId,
              target: targetId,
              type: 'depends'
            });
          }
        }
      }
    }
  }

  return { nodes, links };
}

/**
 * Render force-directed graph
 */
function renderGraph(structureData) {
  const container = overlay.querySelector('.structure-map-canvas');

  // Recreate SVG if it doesn't exist (e.g., after tree view)
  let svgElement = container.querySelector('#structure-map-svg');
  if (!svgElement) {
    container.innerHTML = '<svg id="structure-map-svg"></svg>';
    svgElement = container.querySelector('#structure-map-svg');
  }

  const svg = d3.select('#structure-map-svg');
  svg.selectAll('*').remove();

  const width = container.clientWidth;
  const height = container.clientHeight;

  svg.attr('width', width).attr('height', height);

  const graph = structureToGraph(structureData);

  if (graph.nodes.length === 0) {
    showError('No modules found in STRUCTURE.json');
    return;
  }

  // Create SVG groups
  const g = svg.append('g');

  // Add zoom behavior
  const zoom = d3.zoom()
    .scaleExtent([0.2, 4])
    .on('zoom', (event) => {
      g.attr('transform', event.transform);
    });

  svg.call(zoom);

  // Create arrow marker for directed edges
  svg.append('defs').append('marker')
    .attr('id', 'arrowhead')
    .attr('viewBox', '-0 -5 10 10')
    .attr('refX', 20)
    .attr('refY', 0)
    .attr('orient', 'auto')
    .attr('markerWidth', 6)
    .attr('markerHeight', 6)
    .append('path')
    .attr('d', 'M 0,-5 L 10,0 L 0,5')
    .attr('fill', 'var(--border-strong)');

  // Create force simulation
  simulation = d3.forceSimulation(graph.nodes)
    .force('link', d3.forceLink(graph.links)
      .id(d => d.id)
      .distance(120)
      .strength(0.5))
    .force('charge', d3.forceManyBody()
      .strength(-400)
      .distanceMax(400))
    .force('center', d3.forceCenter(width / 2, height / 2))
    .force('collision', d3.forceCollide().radius(50));

  // Create links
  const link = g.append('g')
    .attr('class', 'links')
    .selectAll('line')
    .data(graph.links)
    .enter()
    .append('line')
    .attr('class', 'graph-link')
    .attr('marker-end', 'url(#arrowhead)');

  // Create node groups
  const node = g.append('g')
    .attr('class', 'nodes')
    .selectAll('g')
    .data(graph.nodes)
    .enter()
    .append('g')
    .attr('class', 'graph-node')
    .call(d3.drag()
      .on('start', dragstarted)
      .on('drag', dragged)
      .on('end', dragended));

  // Add circles to nodes
  node.append('circle')
    .attr('r', d => {
      // Size based on number of exports/functions
      const size = Object.keys(d.functions).length + (d.exports?.length || 0);
      return Math.max(12, Math.min(25, 8 + size));
    })
    .attr('fill', d => MODULE_COLORS[d.type] || MODULE_COLORS.shared)
    .attr('stroke', 'var(--bg-deep)')
    .attr('stroke-width', 2);

  // Add labels to nodes
  node.append('text')
    .attr('dy', 4)
    .attr('text-anchor', 'middle')
    .attr('class', 'node-label')
    .text(d => d.name);

  // Add hover interactions
  node.on('mouseover', (event, d) => {
    showModuleInfo(d);
    highlightConnections(d, graph.links, node, link);
  })
  .on('mouseout', () => {
    resetHighlight(node, link);
    showPlaceholder();
  })
  .on('click', (event, d) => {
    event.stopPropagation();
    // Single click to select and show info with git button
    selectNode(d, node);
    showModuleInfo(d, true);
  });

  // Update positions on tick
  simulation.on('tick', () => {
    link
      .attr('x1', d => d.source.x)
      .attr('y1', d => d.source.y)
      .attr('x2', d => d.target.x)
      .attr('y2', d => d.target.y);

    node.attr('transform', d => `translate(${d.x},${d.y})`);
  });

  // Drag functions
  function dragstarted(event, d) {
    if (!event.active) simulation.alphaTarget(0.3).restart();
    d.fx = d.x;
    d.fy = d.y;
  }

  function dragged(event, d) {
    d.fx = event.x;
    d.fy = event.y;
  }

  function dragended(event, d) {
    if (!event.active) simulation.alphaTarget(0);
    d.fx = null;
    d.fy = null;
  }

  // Initial zoom to fit
  setTimeout(() => {
    const bounds = g.node().getBBox();
    const fullWidth = width;
    const fullHeight = height;
    const midX = bounds.x + bounds.width / 2;
    const midY = bounds.y + bounds.height / 2;
    const scale = 0.8 / Math.max(bounds.width / fullWidth, bounds.height / fullHeight);
    const translate = [fullWidth / 2 - scale * midX, fullHeight / 2 - scale * midY];

    svg.transition()
      .duration(750)
      .call(zoom.transform, d3.zoomIdentity
        .translate(translate[0], translate[1])
        .scale(scale));
  }, 500);
}

/**
 * Render tree/hierarchy view using D3.js
 */
function renderTreeView(structureData) {
  const container = overlay.querySelector('.structure-map-canvas');

  // Recreate SVG for tree view
  container.innerHTML = '<svg id="structure-map-svg"></svg>';

  // Stop any running simulation
  if (simulation) {
    simulation.stop();
    simulation = null;
  }

  const svg = d3.select('#structure-map-svg');
  const width = container.clientWidth;
  const height = container.clientHeight;

  svg.attr('width', width).attr('height', height);

  // Build hierarchy data
  const hierarchyData = buildHierarchy(structureData);

  // Create main group for zoom/pan
  const g = svg.append('g').attr('class', 'tree-group');

  // Add gradient definitions for connections
  const defs = svg.append('defs');

  // Glow filter for connections
  const glowFilter = defs.append('filter')
    .attr('id', 'glow')
    .attr('x', '-50%')
    .attr('y', '-50%')
    .attr('width', '200%')
    .attr('height', '200%');
  glowFilter.append('feGaussianBlur')
    .attr('stdDeviation', '2')
    .attr('result', 'coloredBlur');
  const feMerge = glowFilter.append('feMerge');
  feMerge.append('feMergeNode').attr('in', 'coloredBlur');
  feMerge.append('feMergeNode').attr('in', 'SourceGraphic');

  // Add zoom behavior (same as graph view)
  const zoom = d3.zoom()
    .scaleExtent([0.2, 3])
    .on('zoom', (event) => {
      g.attr('transform', event.transform);
    });

  svg.call(zoom);

  // Create tree layout
  const treeLayout = d3.tree()
    .nodeSize([180, 120]) // Horizontal spacing, vertical spacing
    .separation((a, b) => a.parent === b.parent ? 1 : 1.2);

  // Create hierarchy
  const root = d3.hierarchy(hierarchyData);

  // Calculate positions
  treeLayout(root);

  // Create curved links
  const linkGenerator = d3.linkVertical()
    .x(d => d.x)
    .y(d => d.y);

  // Draw connections
  const links = g.append('g')
    .attr('class', 'tree-links')
    .selectAll('path')
    .data(root.links())
    .enter()
    .append('path')
    .attr('class', 'tree-link')
    .attr('d', linkGenerator)
    .attr('fill', 'none')
    .attr('stroke', d => {
      // Color based on target node type
      const targetType = d.target.data.type;
      return MODULE_COLORS[targetType] || 'var(--border-subtle)';
    })
    .attr('stroke-width', 2)
    .attr('stroke-opacity', 0.6)
    .attr('filter', 'url(#glow)')
    .style('stroke-dasharray', function() {
      return this.getTotalLength();
    })
    .style('stroke-dashoffset', function() {
      return this.getTotalLength();
    });

  // Animate links appearing
  links.transition()
    .duration(800)
    .delay((d, i) => i * 50)
    .ease(d3.easeQuadOut)
    .style('stroke-dashoffset', 0);

  // Draw nodes
  const nodes = g.append('g')
    .attr('class', 'tree-nodes')
    .selectAll('g')
    .data(root.descendants())
    .enter()
    .append('g')
    .attr('class', d => `tree-node tree-node-${d.data.nodeType}`)
    .attr('transform', d => `translate(${d.x},${d.y})`)
    .style('opacity', 0);

  // Animate nodes appearing
  nodes.transition()
    .duration(500)
    .delay((d, i) => 200 + i * 30)
    .ease(d3.easeBackOut.overshoot(1.2))
    .style('opacity', 1);

  // Root node (project)
  nodes.filter(d => d.depth === 0)
    .append('rect')
    .attr('class', 'node-rect node-root')
    .attr('x', -70)
    .attr('y', -25)
    .attr('width', 140)
    .attr('height', 50)
    .attr('rx', 8)
    .attr('fill', 'var(--bg-surface)')
    .attr('stroke', 'var(--accent)')
    .attr('stroke-width', 2);

  nodes.filter(d => d.depth === 0)
    .append('text')
    .attr('class', 'node-title')
    .attr('text-anchor', 'middle')
    .attr('dy', -4)
    .attr('fill', 'var(--accent)')
    .attr('font-weight', '600')
    .attr('font-size', '14px')
    .text(d => d.data.name);

  nodes.filter(d => d.depth === 0)
    .append('text')
    .attr('class', 'node-subtitle')
    .attr('text-anchor', 'middle')
    .attr('dy', 14)
    .attr('fill', 'var(--text-secondary)')
    .attr('font-size', '10px')
    .text('Project Structure');

  // Group nodes (main, renderer, shared)
  const groupNodes = nodes.filter(d => d.depth === 1);

  groupNodes.append('rect')
    .attr('class', 'node-rect node-group')
    .attr('x', -65)
    .attr('y', -22)
    .attr('width', 130)
    .attr('height', 44)
    .attr('rx', 6)
    .attr('fill', 'var(--bg-elevated)')
    .attr('stroke', d => MODULE_COLORS[d.data.type] || 'var(--border-subtle)')
    .attr('stroke-width', 2);

  groupNodes.append('circle')
    .attr('class', 'group-dot')
    .attr('cx', -50)
    .attr('cy', 0)
    .attr('r', 5)
    .attr('fill', d => MODULE_COLORS[d.data.type] || 'var(--border-subtle)');

  groupNodes.append('text')
    .attr('class', 'node-group-title')
    .attr('text-anchor', 'start')
    .attr('x', -40)
    .attr('dy', -4)
    .attr('fill', 'var(--text-primary)')
    .attr('font-weight', '500')
    .attr('font-size', '12px')
    .text(d => d.data.label);

  groupNodes.append('text')
    .attr('class', 'node-group-count')
    .attr('text-anchor', 'start')
    .attr('x', -40)
    .attr('dy', 12)
    .attr('fill', 'var(--text-secondary)')
    .attr('font-size', '10px')
    .text(d => `${d.data.moduleCount || 0} modules`);

  // Module nodes
  const moduleNodes = nodes.filter(d => d.depth === 2);

  moduleNodes.append('rect')
    .attr('class', 'node-rect node-module')
    .attr('x', -60)
    .attr('y', -18)
    .attr('width', 120)
    .attr('height', 36)
    .attr('rx', 4)
    .attr('fill', 'var(--bg-surface)')
    .attr('stroke', d => MODULE_COLORS[d.data.type] || 'var(--border-subtle)')
    .attr('stroke-width', 1.5)
    .attr('stroke-opacity', 0.7);

  moduleNodes.append('text')
    .attr('class', 'node-module-name')
    .attr('text-anchor', 'middle')
    .attr('dy', -2)
    .attr('fill', 'var(--text-primary)')
    .attr('font-size', '11px')
    .attr('font-family', 'var(--font-mono)')
    .text(d => d.data.name.length > 14 ? d.data.name.substring(0, 12) + '...' : d.data.name);

  moduleNodes.append('text')
    .attr('class', 'node-module-meta')
    .attr('text-anchor', 'middle')
    .attr('dy', 12)
    .attr('fill', 'var(--text-muted)')
    .attr('font-size', '9px')
    .text(d => {
      const parts = [];
      if (d.data.functionCount > 0) parts.push(`${d.data.functionCount}fn`);
      if (d.data.exportCount > 0) parts.push(`${d.data.exportCount}exp`);
      return parts.join(' · ') || '';
    });

  // Add hover and click interactions
  const moduleRects = moduleNodes.selectAll('.node-module');

  moduleNodes
    .style('cursor', 'pointer')
    .on('mouseover', function(event, d) {
      d3.select(this).select('.node-module')
        .transition()
        .duration(150)
        .attr('stroke-width', 2.5)
        .attr('stroke-opacity', 1)
        .attr('fill', 'var(--bg-elevated)');

      // Show module info on hover
      if (d.data.moduleData) {
        showModuleInfo(d.data.moduleData, false);
      }
    })
    .on('mouseout', function(event, d) {
      if (selectedNode && selectedNode.id === d.data.id) return;

      d3.select(this).select('.node-module')
        .transition()
        .duration(150)
        .attr('stroke-width', 1.5)
        .attr('stroke-opacity', 0.7)
        .attr('fill', 'var(--bg-surface)');

      if (!selectedNode) {
        showPlaceholder();
      }
    })
    .on('click', function(event, d) {
      event.stopPropagation();

      // Deselect all
      moduleNodes.selectAll('.node-module')
        .attr('stroke-width', 1.5)
        .attr('stroke-opacity', 0.7)
        .attr('fill', 'var(--bg-surface)');

      // Select this one
      d3.select(this).select('.node-module')
        .attr('stroke-width', 3)
        .attr('stroke-opacity', 1)
        .attr('fill', 'var(--bg-elevated)');

      if (d.data.moduleData) {
        selectedNode = d.data.moduleData;
        showModuleInfo(d.data.moduleData, true);
      }
    });

  // Click on empty space to deselect
  svg.on('click', () => {
    selectedNode = null;
    moduleNodes.selectAll('.node-module')
      .attr('stroke-width', 1.5)
      .attr('stroke-opacity', 0.7)
      .attr('fill', 'var(--bg-surface)');
    showPlaceholder();
  });

  // Center and fit the tree
  setTimeout(() => {
    const bounds = g.node().getBBox();
    const fullWidth = width;
    const fullHeight = height;
    const midX = bounds.x + bounds.width / 2;
    const midY = bounds.y + bounds.height / 2;
    const scale = 0.85 / Math.max(bounds.width / fullWidth, bounds.height / fullHeight);
    const translate = [fullWidth / 2 - scale * midX, fullHeight / 2 - scale * midY];

    svg.transition()
      .duration(750)
      .call(zoom.transform, d3.zoomIdentity
        .translate(translate[0], translate[1])
        .scale(Math.min(scale, 1.2)));
  }, 100);
}

/**
 * Build hierarchy data for D3 tree
 */
function buildHierarchy(structureData) {
  // Group modules by type
  const groups = {
    main: [],
    renderer: [],
    shared: []
  };

  if (structureData.modules) {
    for (const [moduleId, moduleData] of Object.entries(structureData.modules)) {
      let type = 'shared';
      if (moduleId.startsWith('main/')) type = 'main';
      else if (moduleId.startsWith('renderer/')) type = 'renderer';
      else if (moduleId.startsWith('shared/')) type = 'shared';

      groups[type].push({
        id: moduleId,
        name: moduleId.split('/').pop(),
        fullName: moduleId,
        type,
        file: moduleData.file,
        exports: moduleData.exports || [],
        functions: moduleData.functions || {},
        ipc: moduleData.ipc || {},
        depends: moduleData.depends || []
      });
    }
  }

  // Sort modules
  Object.values(groups).forEach(group => {
    group.sort((a, b) => a.name.localeCompare(b.name));
  });

  // Build tree structure
  const typeLabels = {
    main: 'Main Process',
    renderer: 'Renderer Process',
    shared: 'Shared Modules'
  };

  return {
    name: 'FRAME',
    nodeType: 'root',
    children: ['main', 'renderer', 'shared'].map(type => ({
      name: typeLabels[type],
      label: typeLabels[type],
      nodeType: 'group',
      type: type,
      moduleCount: groups[type].length,
      children: groups[type].map(module => ({
        name: module.name,
        nodeType: 'module',
        type: module.type,
        id: module.id,
        functionCount: Object.keys(module.functions).length,
        exportCount: module.exports.length,
        moduleData: module
      }))
    }))
  };
}

/**
 * Show module info in panel (1x3 grid layout)
 */
function showModuleInfo(module, showGitButton = true) {
  const infoPanel = overlay.querySelector('.info-panel-content');
  currentModule = module;

  const functionCount = Object.keys(module.functions).length;
  const exportCount = module.exports?.length || 0;
  const hasIpc = module.ipc && (module.ipc.listens?.length > 0 || module.ipc.emits?.length > 0);

  // Functions list
  let functionsHtml = '<div class="empty-hint">No functions</div>';
  if (functionCount > 0) {
    const funcList = Object.entries(module.functions)
      .slice(0, 6)
      .map(([name, data]) => `<div class="func-item"><span class="func-name">${name}()</span></div>`)
      .join('');
    const moreCount = functionCount - 6;
    functionsHtml = `
      <div class="func-list">${funcList}</div>
      ${moreCount > 0 ? `<div class="more-hint">+${moreCount} more</div>` : ''}
    `;
  }

  // Exports list
  let exportsHtml = '<div class="empty-hint">No exports</div>';
  if (exportCount > 0) {
    const exportList = module.exports
      .slice(0, 6)
      .map(exp => `<span class="export-tag">${exp}</span>`)
      .join('');
    const moreCount = exportCount - 6;
    exportsHtml = `
      <div class="export-list">${exportList}</div>
      ${moreCount > 0 ? `<div class="more-hint">+${moreCount} more</div>` : ''}
    `;
  }

  // IPC section
  let ipcHtml = '<div class="empty-hint">No IPC channels</div>';
  if (hasIpc) {
    const listens = module.ipc.listens || [];
    const emits = module.ipc.emits || [];
    ipcHtml = `
      ${listens.length > 0 ? `
        <div class="ipc-group">
          <span class="ipc-label">Listens:</span>
          <div class="ipc-channels">${listens.slice(0, 3).map(c => `<span class="ipc-channel">${c}</span>`).join('')}</div>
          ${listens.length > 3 ? `<div class="more-hint">+${listens.length - 3} more</div>` : ''}
        </div>
      ` : ''}
      ${emits.length > 0 ? `
        <div class="ipc-group">
          <span class="ipc-label">Emits:</span>
          <div class="ipc-channels">${emits.slice(0, 3).map(c => `<span class="ipc-channel">${c}</span>`).join('')}</div>
          ${emits.length > 3 ? `<div class="more-hint">+${emits.length - 3} more</div>` : ''}
        </div>
      ` : ''}
    `;
  }

  infoPanel.innerHTML = `
    <div class="info-module-grid">
      <!-- Header Row -->
      <div class="info-header-row">
        <div class="info-title-section">
          <span class="info-type-badge" style="background: ${MODULE_COLORS[module.type]}">${module.type}</span>
          <span class="info-module-name">${module.fullName}</span>
        </div>
        ${module.file ? `<div class="info-file-path">${module.file}</div>` : ''}
      </div>

      <!-- 1x3 Grid -->
      <div class="info-cards-grid">
        <!-- Card 1: Module Info -->
        <div class="info-card">
          <div class="info-card-header">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"></path>
              <polyline points="13 2 13 9 20 9"></polyline>
            </svg>
            <span>Module Info</span>
          </div>
          <div class="info-card-content">
            <div class="info-stat-row">
              <span class="stat-label">Functions</span>
              <span class="stat-value">${functionCount}</span>
            </div>
            <div class="info-stat-row">
              <span class="stat-label">Exports</span>
              <span class="stat-value">${exportCount}</span>
            </div>
            <div class="info-divider"></div>
            <div class="info-mini-section">
              <div class="mini-title">Exports</div>
              ${exportsHtml}
            </div>
          </div>
        </div>

        <!-- Card 2: Functions & IPC -->
        <div class="info-card">
          <div class="info-card-header">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <polyline points="16 18 22 12 16 6"></polyline>
              <polyline points="8 6 2 12 8 18"></polyline>
            </svg>
            <span>Code Details</span>
          </div>
          <div class="info-card-content">
            <div class="info-mini-section">
              <div class="mini-title">Functions</div>
              ${functionsHtml}
            </div>
            <div class="info-divider"></div>
            <div class="info-mini-section">
              <div class="mini-title">IPC Channels</div>
              ${ipcHtml}
            </div>
          </div>
        </div>

        <!-- Card 3: Git History -->
        <div class="info-card info-card-git">
          <div class="info-card-header">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <circle cx="12" cy="12" r="10"></circle>
              <polyline points="12 6 12 12 16 14"></polyline>
            </svg>
            <span>Git History</span>
            ${showGitButton && module.file ? `
              <button class="btn-load-git" data-file="${module.file}" title="Load git history">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <polyline points="23 4 23 10 17 10"></polyline>
                  <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"></path>
                </svg>
              </button>
            ` : ''}
          </div>
          <div class="info-card-content info-git-container">
            <div class="git-placeholder">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" opacity="0.4">
                <path d="M9 19c-5 1.5-5-2.5-7-3m14 6v-3.87a3.37 3.37 0 0 0-.94-2.61c3.14-.35 6.44-1.54 6.44-7A5.44 5.44 0 0 0 20 4.77 5.07 5.07 0 0 0 19.91 1S18.73.65 16 2.48a13.38 13.38 0 0 0-7 0C6.27.65 5.09 1 5.09 1A5.07 5.07 0 0 0 5 4.77a5.44 5.44 0 0 0-1.5 3.78c0 5.42 3.3 6.61 6.44 7A3.37 3.37 0 0 0 9 18.13V22"/>
              </svg>
              <span>Click refresh to load</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  `;

  // Add click handler for git history button
  const gitBtn = infoPanel.querySelector('.btn-load-git');
  if (gitBtn) {
    gitBtn.addEventListener('click', () => {
      loadAndShowGitHistory(module);
    });
  }
}

/**
 * Select a node (visual indicator)
 */
function selectNode(d, nodeSelection) {
  selectedNode = d;
  nodeSelection.classed('selected', n => n.id === d.id);
}

/**
 * Load and show git history for a module
 */
async function loadAndShowGitHistory(module) {
  if (!module.file || !currentProjectPath) {
    console.log('Missing file or projectPath');
    return;
  }

  // Get git container and button
  const gitContainer = overlay.querySelector('.info-git-container');
  const gitBtn = overlay.querySelector('.btn-load-git');

  if (!gitContainer) {
    console.log('No git container found');
    return;
  }

  // Check if button is already disabled (loading)
  if (gitBtn && gitBtn.disabled) {
    console.log('Button disabled, already loading');
    return;
  }

  // Disable button and show loading
  if (gitBtn) {
    gitBtn.disabled = true;
    gitBtn.classList.add('loading');
  }

  gitContainer.innerHTML = `
    <div class="git-loading-state">
      <div class="git-spinner"></div>
      <span>Loading...</span>
    </div>
  `;

  try {
    console.log('Fetching git history for:', module.file);
    const history = await ipcRenderer.invoke(IPC.GET_FILE_GIT_HISTORY, currentProjectPath, module.file);
    console.log('Git history received:', history);

    if (history.error) {
      gitContainer.innerHTML = `
        <div class="git-error-state">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="12" cy="12" r="10"></circle>
            <line x1="15" y1="9" x2="9" y2="15"></line>
            <line x1="9" y1="9" x2="15" y2="15"></line>
          </svg>
          <span>${escapeHtml(history.error)}</span>
        </div>
      `;
    } else {
      const html = renderGitHistory(history);
      gitContainer.innerHTML = html;
    }

    // Update button to show success
    if (gitBtn) {
      gitBtn.classList.remove('loading');
      gitBtn.classList.add('loaded');
    }
  } catch (err) {
    console.error('Git history error:', err);
    gitContainer.innerHTML = `
      <div class="git-error-state">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <circle cx="12" cy="12" r="10"></circle>
          <line x1="15" y1="9" x2="9" y2="15"></line>
          <line x1="9" y1="9" x2="15" y2="15"></line>
        </svg>
        <span>Failed to load</span>
      </div>
    `;
    // Re-enable button on error
    if (gitBtn) {
      gitBtn.disabled = false;
      gitBtn.classList.remove('loading');
    }
  }
}

/**
 * Render git history HTML (compact card format)
 */
function renderGitHistory(history) {
  const { contributors, commits, blame } = history;

  let contributorsHtml = '';
  if (contributors && contributors.length > 0) {
    contributorsHtml = `
      <div class="git-section">
        <div class="git-section-title">Contributors</div>
        <div class="git-contributors-compact">
          ${contributors.slice(0, 4).map(c => `
            <div class="contributor-row">
              <span class="contributor-avatar-sm">${getInitials(c.name)}</span>
              <span class="contributor-info">
                <span class="contributor-name-sm">${escapeHtml(c.name.split(' ')[0])}</span>
                <span class="contributor-count">${c.commits}</span>
              </span>
            </div>
          `).join('')}
        </div>
      </div>
    `;
  }

  let commitsHtml = '';
  if (commits && commits.length > 0) {
    commitsHtml = `
      <div class="git-section">
        <div class="git-section-title">Recent Commits</div>
        <div class="git-commits-compact">
          ${commits.slice(0, 4).map(c => `
            <div class="commit-row">
              <span class="commit-hash-sm">${c.hash}</span>
              <span class="commit-msg-sm" title="${escapeHtml(c.message)}">${escapeHtml(c.message.substring(0, 30))}${c.message.length > 30 ? '...' : ''}</span>
              <span class="commit-date-sm">${c.date}</span>
            </div>
          `).join('')}
        </div>
      </div>
    `;
  }

  if (!contributorsHtml && !commitsHtml) {
    return `
      <div class="git-empty-state">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" opacity="0.4">
          <circle cx="12" cy="12" r="10"></circle>
          <path d="M8 12h8"></path>
        </svg>
        <span>No git history</span>
      </div>
    `;
  }

  return `
    <div class="git-history-content">
      ${contributorsHtml}
      ${commitsHtml}
    </div>
  `;
}

/**
 * Get initials from name
 */
function getInitials(name) {
  return name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2);
}

/**
 * Escape HTML
 */
/**
 * Show placeholder in info panel
 */
function showPlaceholder() {
  if (selectedNode) return; // Don't clear if a node is selected
  const infoPanel = overlay.querySelector('.info-panel-content');
  infoPanel.innerHTML = `
    <div class="info-placeholder">
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" opacity="0.3">
        <circle cx="12" cy="12" r="10"></circle>
        <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"></path>
        <line x1="12" y1="17" x2="12.01" y2="17"></line>
      </svg>
      <span>Click on a module to see details</span>
    </div>
  `;
}

/**
 * Highlight connections for a node
 */
function highlightConnections(d, links, nodeSelection, linkSelection) {
  const connectedNodes = new Set([d.id]);

  links.forEach(link => {
    if (link.source.id === d.id) connectedNodes.add(link.target.id);
    if (link.target.id === d.id) connectedNodes.add(link.source.id);
  });

  nodeSelection.classed('dimmed', n => !connectedNodes.has(n.id));
  nodeSelection.classed('highlighted', n => n.id === d.id);

  linkSelection.classed('dimmed', l => l.source.id !== d.id && l.target.id !== d.id);
  linkSelection.classed('highlighted', l => l.source.id === d.id || l.target.id === d.id);
}

/**
 * Reset highlight
 */
function resetHighlight(nodeSelection, linkSelection) {
  nodeSelection.classed('dimmed', false).classed('highlighted', false);
  linkSelection.classed('dimmed', false).classed('highlighted', false);
}

/**
 * Check if visible
 */
function isMapVisible() {
  return isVisible;
}

module.exports = {
  init,
  show,
  hide,
  isVisible: isMapVisible
};
