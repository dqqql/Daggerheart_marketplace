(function () {
  'use strict';

  function defaultEscapeHtml(value) {
    if (!value) return '';
    var div = document.createElement('div');
    div.appendChild(document.createTextNode(String(value)));
    return div.innerHTML;
  }

  function defaultEscapeAttr(value) {
    if (!value) return '';
    return String(value)
      .replace(/&/g, '&amp;')
      .replace(/"/g, '&quot;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function createCropper(root, options) {
    var panel = root.querySelector('[data-role="cropper-panel"]');
    var main = root.querySelector('[data-role="cropper-main"]');
    var canvas = root.querySelector('[data-role="cropper-canvas"]');
    var cropBtn = root.querySelector('[data-role="cropper-confirm"]');
    var cancelBtn = root.querySelector('[data-role="cropper-cancel"]');
    var fileInput = root.querySelector('[data-role="cover-file"]');
    var preview = root.querySelector('[data-role="cover-preview"]');
    var status = root.querySelector('[data-role="cover-status"]');
    var ctx = canvas.getContext('2d');
    var OUT_W = 600;
    var OUT_H = 800;
    var CANVAS_W = 360;
    var CANVAS_H = 480;
    var ZOOM_SENSITIVITY = 0.0004;

    canvas.width = CANVAS_W;
    canvas.height = CANVAS_H;

    var cropImg = null;
    var cropScale = 1;
    var cropIW = 0;
    var cropIH = 0;
    var cropOX = 0;
    var cropOY = 0;
    var cropX = 0;
    var cropY = 0;
    var cropW = 0;
    var cropH = 0;
    var dragging = false;
    var dragStartX = 0;
    var dragStartY = 0;
    var dragStartCX = 0;
    var dragStartCY = 0;

    function syncCursor() {
      main.style.cursor = cropImg ? (dragging ? 'grabbing' : 'grab') : 'default';
    }

    function getCanvasPoint(evt) {
      var rect = main.getBoundingClientRect();
      return {
        x: (evt.clientX - rect.left) * (CANVAS_W / rect.width),
        y: (evt.clientY - rect.top) * (CANVAS_H / rect.height)
      };
    }

    function drawCropper() {
      if (!cropImg) return;
      ctx.clearRect(0, 0, CANVAS_W, CANVAS_H);
      ctx.drawImage(cropImg, cropOX, cropOY, cropIW, cropIH);
      ctx.fillStyle = 'rgba(0,0,0,0.55)';
      ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
      ctx.save();
      ctx.beginPath();
      ctx.rect(cropX, cropY, cropW, cropH);
      ctx.clip();
      ctx.clearRect(0, 0, CANVAS_W, CANVAS_H);
      ctx.drawImage(cropImg, cropOX, cropOY, cropIW, cropIH);
      ctx.restore();
      ctx.strokeStyle = '#ddc078';
      ctx.lineWidth = 2;
      ctx.strokeRect(cropX, cropY, cropW, cropH);
      ctx.fillStyle = '#ddc078';
      var size = 8;
      ctx.fillRect(cropX, cropY, size, size);
      ctx.fillRect(cropX + cropW - size, cropY, size, size);
      ctx.fillRect(cropX, cropY + cropH - size, size, size);
      ctx.fillRect(cropX + cropW - size, cropY + cropH - size, size, size);
      ctx.strokeStyle = 'rgba(255,255,255,0.2)';
      ctx.lineWidth = 0.5;
      ctx.beginPath();
      ctx.moveTo(cropX + cropW / 3, cropY);
      ctx.lineTo(cropX + cropW / 3, cropY + cropH);
      ctx.moveTo(cropX + cropW * 2 / 3, cropY);
      ctx.lineTo(cropX + cropW * 2 / 3, cropY + cropH);
      ctx.moveTo(cropX, cropY + cropH / 3);
      ctx.lineTo(cropX + cropW, cropY + cropH / 3);
      ctx.moveTo(cropX, cropY + cropH * 2 / 3);
      ctx.lineTo(cropX + cropW, cropY + cropH * 2 / 3);
      ctx.stroke();
    }

    function initCropBox() {
      cropH = cropIH * 0.9;
      cropW = cropH * 0.75;
      if (cropW > cropIW) {
        cropW = cropIW;
        cropH = cropW / 0.75;
      }
      cropX = cropOX + (cropIW - cropW) / 2;
      cropY = cropOY + (cropIH - cropH) / 2;
      drawCropper();
      syncCursor();
    }

    function applyZoom(ratio, cx, cy) {
      var newH = clamp(cropH * ratio, 60, cropIH);
      var newW = newH * 0.75;
      var kx = cx !== undefined ? cx : cropX + cropW / 2;
      var ky = cy !== undefined ? cy : cropY + cropH / 2;
      var scale = newW / cropW;
      cropW = newW;
      cropH = newH;
      cropX = clamp(kx - (kx - cropX) * scale, cropOX, cropOX + cropIW - cropW);
      cropY = clamp(ky - (ky - cropY) * scale, cropOY, cropOY + cropIH - cropH);
      drawCropper();
    }

    function getCropSourceRect() {
      var sw = cropW / cropScale;
      var sh = cropH / cropScale;
      return {
        sx: clamp((cropX - cropOX) / cropScale, 0, cropImg.width - sw),
        sy: clamp((cropY - cropOY) / cropScale, 0, cropImg.height - sh),
        sw: sw,
        sh: sh
      };
    }

    function stopDragging() {
      if (!dragging) return;
      dragging = false;
      syncCursor();
    }

    function reset() {
      cropImg = null;
      panel.classList.remove('active');
      fileInput.value = '';
      ctx.clearRect(0, 0, CANVAS_W, CANVAS_H);
      stopDragging();
      syncCursor();
    }

    async function uploadCropped() {
      if (!cropImg) return;
      var outCanvas = document.createElement('canvas');
      outCanvas.width = OUT_W;
      outCanvas.height = OUT_H;
      var outCtx = outCanvas.getContext('2d');
      var rect = getCropSourceRect();
      outCtx.drawImage(cropImg, rect.sx, rect.sy, rect.sw, rect.sh, 0, 0, OUT_W, OUT_H);

      status.textContent = '上传中…';
      status.className = 'cover-upload-status';
      try {
        var blob = await new Promise(function (resolve) {
          outCanvas.toBlob(resolve, 'image/webp', 0.85);
        });
        var formData = new FormData();
        formData.append('file', blob, 'cover.webp');
        var response = await options.uploadCover(formData);
        options.onCoverUploaded(response.coverPath);
        preview.innerHTML = '<img src="' + options.escAttr(response.coverPath) + '" alt="封面预览">';
        status.textContent = '上传成功';
        status.className = 'cover-upload-status success';
        reset();
      } catch (err) {
        status.textContent = err.message;
        status.className = 'cover-upload-status error';
      }
    }

    fileInput.addEventListener('change', function () {
      var file = fileInput.files[0];
      if (!file) return;
      var reader = new FileReader();
      reader.onload = function (event) {
        cropImg = new Image();
        cropImg.onload = function () {
          var scaleW = CANVAS_W / cropImg.width;
          var scaleH = CANVAS_H / cropImg.height;
          cropScale = Math.min(scaleW, scaleH);
          cropIW = cropImg.width * cropScale;
          cropIH = cropImg.height * cropScale;
          cropOX = (CANVAS_W - cropIW) / 2;
          cropOY = (CANVAS_H - cropIH) / 2;
          initCropBox();
          panel.classList.add('active');
        };
        cropImg.src = event.target.result;
      };
      reader.readAsDataURL(file);
    });

    main.addEventListener('wheel', function (evt) {
      if (!cropImg) return;
      evt.preventDefault();
      var point = getCanvasPoint(evt);
      applyZoom(Math.exp(evt.deltaY * ZOOM_SENSITIVITY), point.x, point.y);
    }, { passive: false });

    main.addEventListener('mousedown', function (evt) {
      if (!cropImg || evt.button !== 0) return;
      var point = getCanvasPoint(evt);
      if (point.x >= cropX && point.x <= cropX + cropW && point.y >= cropY && point.y <= cropY + cropH) {
        dragging = true;
        dragStartX = point.x;
        dragStartY = point.y;
        dragStartCX = cropX;
        dragStartCY = cropY;
        syncCursor();
        evt.preventDefault();
      }
    });

    main.addEventListener('mouseleave', stopDragging);
    window.addEventListener('mousemove', function (evt) {
      if (!dragging) return;
      var point = getCanvasPoint(evt);
      cropX = clamp(dragStartCX + (point.x - dragStartX), cropOX, cropOX + cropIW - cropW);
      cropY = clamp(dragStartCY + (point.y - dragStartY), cropOY, cropOY + cropIH - cropH);
      drawCropper();
    });
    window.addEventListener('mouseup', stopDragging);
    cropBtn.addEventListener('click', uploadCropped);
    cancelBtn.addEventListener('click', reset);

    return {
      reset: reset,
      clearStatus: function () {
        status.textContent = '';
        status.className = 'cover-upload-status';
      }
    };
  }

  function bindChipInput(wrap) {
    if (!wrap || wrap.dataset.bound === '1') return;
    wrap.dataset.bound = '1';
    var input = wrap.querySelector('.chip-input');
    if (!input) return;

    function getValues() {
      return Array.from(wrap.querySelectorAll('.chip')).map(function (chip) {
        return chip.dataset.tag;
      }).filter(Boolean);
    }

    function attachRemove(chip) {
      var button = chip.querySelector('.chip-remove');
      if (!button) return;
      button.addEventListener('click', function () {
        chip.remove();
        input.focus();
      });
    }

    wrap.querySelectorAll('.chip').forEach(attachRemove);

    input.addEventListener('keydown', function (evt) {
      if (evt.key === 'Enter' || evt.key === ',') {
        evt.preventDefault();
        var value = input.value.trim();
        if (!value || getValues().includes(value)) {
          input.value = '';
          return;
        }
        var chip = document.createElement('span');
        chip.className = 'chip';
        chip.dataset.tag = value;
        chip.innerHTML = defaultEscapeHtml(value) + '<button class="chip-remove" type="button">&times;</button>';
        attachRemove(chip);
        wrap.insertBefore(chip, input);
        input.value = '';
      }
      if (evt.key === 'Backspace' && input.value === '') {
        var chips = wrap.querySelectorAll('.chip');
        if (chips.length) chips[chips.length - 1].remove();
      }
    });

    wrap.addEventListener('click', function (evt) {
      if (evt.target === wrap) input.focus();
    });
  }

  function getChipValues(wrap) {
    return wrap
      ? Array.from(wrap.querySelectorAll('.chip')).map(function (chip) { return chip.dataset.tag; }).filter(Boolean)
      : [];
  }

  function createMarkup(config) {
    var escHtml = config.escHtml;
    var escAttr = config.escAttr;
    var values = config.values;
    return ''
      + '<div class="form-group full">'
      + '<span class="form-label">封面图片</span>'
      + '<div class="cover-upload-area">'
      + '<div class="cover-preview" data-role="cover-preview">'
      + (values.coverPath
        ? '<img src="' + escAttr(values.coverPath) + '" alt="封面预览" onerror="this.style.display=\'none\';this.nextElementSibling.style.display=\'block\'"><span class="cover-preview-placeholder" style="display:none">&#9876;</span>'
        : '<span class="cover-preview-placeholder">&#9876;</span>')
      + '</div>'
      + '<div class="cover-upload-controls">'
      + '<input type="file" class="input" data-role="cover-file" accept="image/png,image/jpeg,image/webp,image/gif">'
      + '<div class="cropper-panel" data-role="cropper-panel">'
      + '<div class="cropper-main" data-role="cropper-main"><canvas data-role="cropper-canvas"></canvas></div>'
      + '<div class="cropper-actions">'
      + '<span class="cropper-hint">左键拖动裁剪框 · 滚轮细调缩放</span>'
      + '<button class="btn btn--gold btn--sm" data-role="cropper-confirm" type="button">确认裁剪</button>'
      + '<button class="btn btn--ghost btn--sm" data-role="cropper-cancel" type="button">取消</button>'
      + '</div></div>'
      + '<span class="cover-upload-status" data-role="cover-status"></span>'
      + '</div></div></div>'
      + '<div class="form-row">'
      + '<div class="form-group">'
      + '<span class="form-label"><span class="required">*</span> 标题</span>'
      + '<input class="input" data-field="title" value="' + escAttr(values.title) + '" placeholder="资源标题">'
      + '</div>'
      + '<div class="form-group">'
      + '<span class="form-label">作者</span>'
      + '<input class="input" data-field="author" value="' + escAttr(values.author) + '" placeholder="制作者署名">'
      + '</div>'
      + '</div>'
      + '<div class="form-group full">'
      + '<span class="form-label">内容标签 <span class="form-hint">— 输入标签后按Enter添加</span></span>'
      + '<div class="chip-input-wrap" data-field="contentTags">'
      + values.contentTags.map(function (tag) {
          return '<span class="chip" data-tag="' + escAttr(tag) + '">' + escHtml(tag) + '<button class="chip-remove" type="button">&times;</button></span>';
        }).join('')
      + '<input class="chip-input" placeholder="输入标签…">'
      + '</div></div>'
      + '<div class="form-group full">'
      + '<span class="form-label">风味标签 <span class="form-hint">— 输入标签后按Enter添加</span></span>'
      + '<div class="chip-input-wrap" data-field="flavorTags">'
      + values.flavorTags.map(function (tag) {
          return '<span class="chip" data-tag="' + escAttr(tag) + '">' + escHtml(tag) + '<button class="chip-remove" type="button">&times;</button></span>';
        }).join('')
      + '<input class="chip-input" placeholder="输入标签…">'
      + '</div></div>'
      + (config.showRecommendValue
        ? '<div class="form-group"><span class="form-label">推荐值</span><input class="input" data-field="recommendValue" type="number" min="0" value="' + escAttr(String(values.recommendValue)) + '" placeholder="0"></div>'
        : '')
      + '<div class="form-group">'
      + '<span class="form-label"><span class="required">*</span> 跳转链接</span>'
      + '<input class="input" data-field="targetUrl" value="' + escAttr(values.targetUrl) + '" placeholder="https://…">'
      + '</div>'
      + '<div class="form-group full">'
      + '<span class="form-label">简介 <span class="form-hint">— 可选，悬停卡片时显示</span></span>'
      + '<textarea class="textarea" data-field="summary" placeholder="简介…">' + escHtml(values.summary) + '</textarea>'
      + '</div>';
  }

  function createResourceForm(options) {
    var escHtml = options.escHtml || defaultEscapeHtml;
    var escAttr = options.escAttr || defaultEscapeAttr;
    var initialValues = options.initialValues || {};
    var values = {
      title: initialValues.title || '',
      author: initialValues.author || '',
      contentTags: Array.isArray(initialValues.contentTags) ? initialValues.contentTags.slice() : [],
      flavorTags: Array.isArray(initialValues.flavorTags) ? initialValues.flavorTags.slice() : [],
      recommendValue: initialValues.recommendValue || 0,
      summary: initialValues.summary || '',
      targetUrl: initialValues.targetUrl || '',
      coverPath: initialValues.coverPath || ''
    };

    options.bodyEl.innerHTML = createMarkup({
      escHtml: escHtml,
      escAttr: escAttr,
      values: values,
      showRecommendValue: options.showRecommendValue !== false
    });

    var titleInput = options.bodyEl.querySelector('[data-field="title"]');
    var authorInput = options.bodyEl.querySelector('[data-field="author"]');
    var contentWrap = options.bodyEl.querySelector('[data-field="contentTags"]');
    var flavorWrap = options.bodyEl.querySelector('[data-field="flavorTags"]');
    var recInput = options.bodyEl.querySelector('[data-field="recommendValue"]');
    var targetInput = options.bodyEl.querySelector('[data-field="targetUrl"]');
    var summaryInput = options.bodyEl.querySelector('[data-field="summary"]');
    var cropper = createCropper(options.bodyEl, {
      uploadCover: options.uploadCover,
      onCoverUploaded: function (coverPath) {
        values.coverPath = coverPath;
      },
      escAttr: escAttr
    });

    bindChipInput(contentWrap);
    bindChipInput(flavorWrap);

    function collect() {
      var payload = {
        title: titleInput.value.trim(),
        author: authorInput.value.trim(),
        contentTags: getChipValues(contentWrap),
        flavorTags: getChipValues(flavorWrap),
        summary: summaryInput.value.trim(),
        targetUrl: targetInput.value.trim(),
        coverPath: values.coverPath
      };
      if (options.showRecommendValue !== false) {
        payload.recommendValue = parseInt(recInput.value || '0', 10) || 0;
      }
      return payload;
    }

    function reset(nextValues) {
      var merged = nextValues || {
        title: '',
        author: '',
        contentTags: [],
        flavorTags: [],
        recommendValue: 0,
        summary: '',
        targetUrl: '',
        coverPath: ''
      };
      createResourceForm({
        bodyEl: options.bodyEl,
        uploadCover: options.uploadCover,
        showRecommendValue: options.showRecommendValue,
        initialValues: merged,
        escHtml: escHtml,
        escAttr: escAttr
      });
    }

    return {
      collect: collect,
      resetCropper: cropper.reset,
      clearCoverStatus: cropper.clearStatus,
      destroy: function () {}
    };
  }

  window.ResourceForm = {
    create: createResourceForm
  };
})();
