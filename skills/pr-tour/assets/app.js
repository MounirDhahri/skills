(function () {
  var data = window.__TOUR_DATA__;
  var state = { index: 0, format: 'line-by-line', viewed: {}, theme: 'dark' };

  var flat = [];
  data.chapters.forEach(function (chapter, chapterIndex) {
    chapter.snapshots.forEach(function (snapshot) {
      flat.push({ chapterIndex: chapterIndex, snapshot: snapshot });
    });
  });

  var multiChapter = data.chapters.length > 1;

  var phaseBarEl = document.getElementById('phase-bar');
  var sidebarBodyEl = document.getElementById('sidebar-body');
  var sidebarFooterEl = document.getElementById('sidebar-footer');
  var titleEl = document.getElementById('snapshot-title');
  var proseEl = document.getElementById('snapshot-prose');
  var diffEl = document.getElementById('diff-container');
  var progressEl = document.getElementById('progress');
  var prevBtn = document.getElementById('prev-btn');
  var nextBtn = document.getElementById('next-btn');
  var lineBtn = document.getElementById('view-line');
  var sideBtn = document.getElementById('view-side');
  var themeToggleBtn = document.getElementById('theme-toggle');
  var hljsThemeDarkEl = document.getElementById('hljs-theme-dark');
  var hljsThemeLightEl = document.getElementById('hljs-theme-light');

  function formatStats(stats) {
    var parts = [];
    if (stats.added) parts.push('<span class="stat-added">+' + stats.added + '</span>');
    if (stats.deleted) parts.push('<span class="stat-deleted">-' + stats.deleted + '</span>');
    return parts.join(' ');
  }

  function formatStatsPlain(stats) {
    var parts = [];
    if (stats.added) parts.push('+' + stats.added);
    if (stats.deleted) parts.push('-' + stats.deleted);
    return parts.join(' ');
  }

  function buildPhaseBar() {
    if (!multiChapter) {
      phaseBarEl.classList.add('hidden');
      return;
    }
    phaseBarEl.innerHTML = '';
    data.chapters.forEach(function (chapter, i) {
      if (i > 0) {
        var line = document.createElement('div');
        line.className = 'phase-line';
        phaseBarEl.appendChild(line);
      }
      var step = document.createElement('div');
      step.className = 'phase-step';
      step.dataset.chapterIndex = String(i);
      var statsText = formatStatsPlain(chapter.stats);
      step.title = chapter.title + (statsText ? ' (' + statsText + ')' : '');

      var dot = document.createElement('div');
      dot.className = 'dot';
      dot.textContent = chapter.icon || String(i + 1);

      var label = document.createElement('div');
      label.className = 'label';
      label.textContent = chapter.title;

      step.appendChild(dot);
      step.appendChild(label);
      step.addEventListener('click', function () {
        var targetIndex = flat.findIndex(function (f) { return f.chapterIndex === i; });
        if (targetIndex !== -1) {
          state.index = targetIndex;
          render();
        }
      });
      phaseBarEl.appendChild(step);
    });
  }

  function updatePhaseBar(currentChapterIndex) {
    if (!multiChapter) return;
    Array.prototype.forEach.call(phaseBarEl.querySelectorAll('.phase-step'), function (step) {
      var i = Number(step.dataset.chapterIndex);
      step.classList.toggle('done', i < currentChapterIndex);
      step.classList.toggle('current', i === currentChapterIndex);
      var dot = step.querySelector('.dot');
      dot.textContent = i < currentChapterIndex ? '✓' : (data.chapters[i].icon || String(i + 1));
    });
  }

  function buildSidebar() {
    sidebarBodyEl.innerHTML = '';
    var flatIndex = 0;
    data.chapters.forEach(function (chapter) {
      var group = document.createElement('div');
      group.className = 'chapter-group';

      if (multiChapter) {
        var heading = document.createElement('div');
        heading.className = 'chapter-heading';
        heading.textContent = (chapter.icon ? chapter.icon + ' ' : '') + chapter.title;
        group.appendChild(heading);
      }

      var list = document.createElement('ol');
      chapter.snapshots.forEach(function (snapshot) {
        var currentFlatIndex = flatIndex;
        var li = document.createElement('li');
        li.dataset.flatIndex = String(currentFlatIndex);

        var titleDiv = document.createElement('div');
        titleDiv.textContent = (currentFlatIndex + 1) + '. ' + snapshot.title;

        var metaDiv = document.createElement('div');
        metaDiv.className = 'meta';
        metaDiv.innerHTML =
          '<span>' + snapshot.fileCount + ' file' + (snapshot.fileCount === 1 ? '' : 's') + '</span>' +
          '<span>' + formatStats(snapshot.stats) + '</span>';

        li.appendChild(titleDiv);
        li.appendChild(metaDiv);
        li.addEventListener('click', function () {
          state.index = currentFlatIndex;
          render();
        });
        list.appendChild(li);
        flatIndex += 1;
      });

      group.appendChild(list);
      sidebarBodyEl.appendChild(group);
    });
  }

  function buildSidebarFooter() {
    sidebarFooterEl.innerHTML = 'Total: ' + formatStats(data.total);
  }

  function renderFileCard(file, snapshotKey) {
    var card = document.createElement('div');
    card.className = 'file-card';
    var fileKey = snapshotKey + '::' + file.path;
    if (state.viewed[fileKey]) card.classList.add('viewed');

    var header = document.createElement('div');
    header.className = 'file-card-header';

    var path = document.createElement('span');
    path.className = 'path';
    path.textContent = (file.status === 'renamed' && file.oldPath && file.oldPath !== file.path)
      ? file.oldPath + ' → ' + file.path
      : file.path;

    var badge = document.createElement('span');
    badge.className = 'status-badge ' + file.status;
    badge.textContent = file.status;

    var stats = document.createElement('span');
    stats.className = 'file-stats';
    stats.innerHTML = formatStats(file.stats);

    var label = document.createElement('label');
    var checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.checked = Boolean(state.viewed[fileKey]);
    checkbox.addEventListener('change', function () {
      state.viewed[fileKey] = checkbox.checked;
      card.classList.toggle('viewed', checkbox.checked);
    });
    label.appendChild(checkbox);
    label.appendChild(document.createTextNode('Viewed'));

    header.appendChild(path);
    header.appendChild(badge);
    header.appendChild(stats);
    header.appendChild(label);

    var body = document.createElement('div');
    body.className = 'file-card-body';

    card.appendChild(header);
    card.appendChild(body);

    var ui = new window.Diff2HtmlUI(body, file.diffText, {
      drawFileList: false,
      matching: 'lines',
      outputFormat: state.format,
      colorScheme: state.theme,
      highlight: true,
    });
    ui.draw();
    ui.highlightCode();

    return card;
  }

  function render() {
    var current = flat[state.index];
    var snapshot = current.snapshot;

    Array.prototype.forEach.call(sidebarBodyEl.querySelectorAll('li'), function (li) {
      li.classList.toggle('active', Number(li.dataset.flatIndex) === state.index);
    });

    updatePhaseBar(current.chapterIndex);

    titleEl.textContent = snapshot.title;
    proseEl.textContent = snapshot.prose;
    progressEl.textContent = (state.index + 1) + ' / ' + flat.length;
    prevBtn.disabled = state.index === 0;
    nextBtn.disabled = state.index === flat.length - 1;

    diffEl.innerHTML = '';
    var snapshotKey = current.chapterIndex + '::' + snapshot.id;
    snapshot.files.forEach(function (file) {
      diffEl.appendChild(renderFileCard(file, snapshotKey));
    });
  }

  function go(delta) {
    var next = state.index + delta;
    if (next < 0 || next >= flat.length) return;
    state.index = next;
    render();
  }

  prevBtn.addEventListener('click', function () { go(-1); });
  nextBtn.addEventListener('click', function () { go(1); });

  lineBtn.addEventListener('click', function () {
    state.format = 'line-by-line';
    lineBtn.classList.add('active');
    sideBtn.classList.remove('active');
    render();
  });
  sideBtn.addEventListener('click', function () {
    state.format = 'side-by-side';
    sideBtn.classList.add('active');
    lineBtn.classList.remove('active');
    render();
  });

  themeToggleBtn.addEventListener('click', function () {
    state.theme = state.theme === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = state.theme;
    hljsThemeDarkEl.disabled = state.theme !== 'dark';
    hljsThemeLightEl.disabled = state.theme !== 'light';
    themeToggleBtn.textContent = state.theme === 'dark' ? '🌙' : '☀️';
    render();
  });

  document.addEventListener('keydown', function (e) {
    var activeTag = document.activeElement && document.activeElement.tagName;
    if (activeTag === 'INPUT' || activeTag === 'TEXTAREA' || activeTag === 'SELECT') return;
    if (e.key === 'ArrowLeft') go(-1);
    if (e.key === 'ArrowRight') go(1);
  });

  buildPhaseBar();
  buildSidebar();
  buildSidebarFooter();
  render();
})();
