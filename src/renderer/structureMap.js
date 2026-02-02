/**
 * Structure Map Module
 * Interactive force-directed graph visualization of project modules
 */

const { ipcRenderer } = require('electron');
const fs = require('fs');
const path = require('path');
const { IPC } = require('../shared/ipcChannels');

let isVisible = false;
let overlay = null;
let simulation = null;
let currentProjectPath = null;
let selectedNode = null;
let currentModule = null;
let isLoadingGitHistory = false;

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
        <div class="info-placeholder">Hover over a module to see details</div>
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
    renderGraph(structureData);
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
  const infoPanel = overlay.querySelector('.structure-map-info');
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
  const svg = d3.select('#structure-map-svg');
  svg.selectAll('*').remove();

  const container = overlay.querySelector('.structure-map-canvas');
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
 * Show module info in panel
 */
function showModuleInfo(module, showGitButton = true) {
  const infoPanel = overlay.querySelector('.structure-map-info');
  currentModule = module;

  const functionCount = Object.keys(module.functions).length;
  const exportCount = module.exports?.length || 0;
  const hasIpc = module.ipc && (module.ipc.listens?.length > 0 || module.ipc.emits?.length > 0);

  let ipcHtml = '';
  if (hasIpc) {
    const listens = module.ipc.listens || [];
    const emits = module.ipc.emits || [];
    ipcHtml = `
      <div class="info-section">
        <div class="info-section-title">IPC</div>
        ${listens.length > 0 ? `<div class="info-ipc"><span class="ipc-badge listens">Listens</span> ${listens.join(', ')}</div>` : ''}
        ${emits.length > 0 ? `<div class="info-ipc"><span class="ipc-badge emits">Emits</span> ${emits.join(', ')}</div>` : ''}
      </div>
    `;
  }

  let functionsHtml = '';
  if (functionCount > 0) {
    const funcList = Object.entries(module.functions)
      .slice(0, 5)
      .map(([name, data]) => `<span class="func-name">${name}()</span>`)
      .join(', ');
    const moreCount = functionCount - 5;
    functionsHtml = `
      <div class="info-section">
        <div class="info-section-title">Functions (${functionCount})</div>
        <div class="info-functions">${funcList}${moreCount > 0 ? ` <span class="more">+${moreCount} more</span>` : ''}</div>
      </div>
    `;
  }

  // Git history button
  let gitButtonHtml = '';
  if (showGitButton && module.file) {
    gitButtonHtml = `
      <button class="btn-view-git-history" data-file="${module.file}">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <circle cx="12" cy="12" r="10"></circle>
          <polyline points="12 6 12 12 16 14"></polyline>
        </svg>
        View Git History
      </button>
    `;
  }

  infoPanel.innerHTML = `
    <div class="info-module">
      <div class="info-header">
        <span class="info-type" style="background: ${MODULE_COLORS[module.type]}">${module.type}</span>
        <span class="info-name">${module.fullName}</span>
        ${gitButtonHtml}
      </div>
      ${module.file ? `<div class="info-file">${module.file}</div>` : ''}
      <div class="info-stats">
        <span class="stat">${functionCount} functions</span>
        <span class="stat">${exportCount} exports</span>
      </div>
      ${functionsHtml}
      ${ipcHtml}
      <div class="info-git-container"></div>
    </div>
  `;

  // Add click handler for git history button
  const gitBtn = infoPanel.querySelector('.btn-view-git-history');
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
  const gitBtn = overlay.querySelector('.btn-view-git-history');

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
    gitBtn.innerHTML = `
      <svg class="spinner" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <circle cx="12" cy="12" r="10"></circle>
      </svg>
      Loading...
    `;
  }

  gitContainer.innerHTML = `
    <div class="git-loading-section">
      <div class="git-loading">Loading git history...</div>
    </div>
  `;

  try {
    console.log('Fetching git history for:', module.file);
    const history = await ipcRenderer.invoke(IPC.GET_FILE_GIT_HISTORY, currentProjectPath, module.file);
    console.log('Git history received:', history);

    if (history.error) {
      gitContainer.innerHTML = `
        <div class="git-error-section">
          <div class="git-error">${escapeHtml(history.error)}</div>
        </div>
      `;
    } else {
      const html = renderGitHistory(history);
      gitContainer.innerHTML = html;
    }

    // Update button to show success
    if (gitBtn) {
      gitBtn.innerHTML = `
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <polyline points="20 6 9 17 4 12"></polyline>
        </svg>
        Loaded
      `;
      gitBtn.classList.add('loaded');
    }
  } catch (err) {
    console.error('Git history error:', err);
    gitContainer.innerHTML = `
      <div class="git-error-section">
        <div class="git-error">Failed: ${escapeHtml(err.message)}</div>
      </div>
    `;
    // Re-enable button on error
    if (gitBtn) {
      gitBtn.disabled = false;
      gitBtn.innerHTML = `
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <circle cx="12" cy="12" r="10"></circle>
          <polyline points="12 6 12 12 16 14"></polyline>
        </svg>
        Retry
      `;
    }
  }
}

/**
 * Render git history HTML
 */
function renderGitHistory(history) {
  const { contributors, commits, blame } = history;

  let contributorsHtml = '';
  if (contributors && contributors.length > 0) {
    contributorsHtml = `
      <div class="git-contributors">
        <div class="git-subtitle">Contributors</div>
        <div class="contributor-list">
          ${contributors.slice(0, 5).map(c => `
            <div class="contributor-item">
              <span class="contributor-avatar">${getInitials(c.name)}</span>
              <span class="contributor-name">${escapeHtml(c.name)}</span>
              <span class="contributor-commits">${c.commits} commits</span>
            </div>
          `).join('')}
        </div>
      </div>
    `;
  }

  let blameHtml = '';
  if (blame && blame.length > 0) {
    const totalLines = blame.reduce((sum, b) => sum + b.lines, 0);
    blameHtml = `
      <div class="git-blame">
        <div class="git-subtitle">Code Ownership</div>
        <div class="blame-bars">
          ${blame.map(b => {
            const percent = Math.round((b.lines / totalLines) * 100);
            return `
              <div class="blame-bar" title="${escapeHtml(b.author)}: ${b.lines} lines (${percent}%)">
                <div class="blame-fill" style="width: ${percent}%"></div>
                <span class="blame-label">${escapeHtml(b.author.split(' ')[0])}</span>
                <span class="blame-percent">${percent}%</span>
              </div>
            `;
          }).join('')}
        </div>
      </div>
    `;
  }

  let commitsHtml = '';
  if (commits && commits.length > 0) {
    commitsHtml = `
      <div class="git-commits">
        <div class="git-subtitle">Recent Commits</div>
        <div class="commit-list">
          ${commits.slice(0, 5).map(c => `
            <div class="commit-item">
              <span class="commit-hash">${c.hash}</span>
              <span class="commit-message">${escapeHtml(c.message)}</span>
              <span class="commit-meta">${escapeHtml(c.author)} - ${c.date}</span>
            </div>
          `).join('')}
        </div>
      </div>
    `;
  }

  if (!contributorsHtml && !blameHtml && !commitsHtml) {
    return `
      <div class="info-section">
        <div class="info-section-title">Git History</div>
        <div class="git-empty">No git history found</div>
      </div>
    `;
  }

  return `
    <div class="info-section info-git-expanded">
      <div class="info-section-title">Git History <span class="git-click-hint">(click to view)</span></div>
      ${contributorsHtml}
      ${blameHtml}
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
function escapeHtml(text) {
  if (!text) return '';
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

/**
 * Show placeholder in info panel
 */
function showPlaceholder() {
  if (selectedNode) return; // Don't clear if a node is selected
  const infoPanel = overlay.querySelector('.structure-map-info');
  infoPanel.innerHTML = '<div class="info-placeholder">Hover over a module to see details. Click to view git history.</div>';
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
