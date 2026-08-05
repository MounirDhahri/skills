(function () {
  var data = window.__TOUR_DATA__;
  var state = { index: 0, format: 'line-by-line' };

  var listEl = document.getElementById('snapshot-list');
  var titleEl = document.getElementById('snapshot-title');
  var proseEl = document.getElementById('snapshot-prose');
  var diffEl = document.getElementById('diff-container');
  var progressEl = document.getElementById('progress');
  var prevBtn = document.getElementById('prev-btn');
  var nextBtn = document.getElementById('next-btn');
  var lineBtn = document.getElementById('view-line');
  var sideBtn = document.getElementById('view-side');

  data.snapshots.forEach(function (snapshot, i) {
    var li = document.createElement('li');
    li.textContent = (i + 1) + '. ' + snapshot.title;
    li.addEventListener('click', function () {
      state.index = i;
      render();
    });
    listEl.appendChild(li);
  });

  function render() {
    var snapshot = data.snapshots[state.index];

    Array.prototype.forEach.call(listEl.children, function (li, i) {
      li.classList.toggle('active', i === state.index);
    });

    titleEl.textContent = snapshot.title;
    proseEl.textContent = snapshot.prose;
    progressEl.textContent = (state.index + 1) + ' / ' + data.snapshots.length;
    prevBtn.disabled = state.index === 0;
    nextBtn.disabled = state.index === data.snapshots.length - 1;

    diffEl.innerHTML = '';
    var ui = new window.Diff2HtmlUI(diffEl, snapshot.diffText, {
      drawFileList: false,
      matching: 'lines',
      outputFormat: state.format,
      colorScheme: 'dark',
      highlight: true,
    });
    ui.draw();
    ui.highlightCode();
  }

  function go(delta) {
    var next = state.index + delta;
    if (next < 0 || next >= data.snapshots.length) return;
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

  document.addEventListener('keydown', function (e) {
    if (e.key === 'ArrowLeft') go(-1);
    if (e.key === 'ArrowRight') go(1);
  });

  render();
})();
