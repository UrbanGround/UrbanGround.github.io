(() => {
  const header = document.querySelector('[data-header]');
  const navToggle = document.querySelector('.nav-toggle');
  const nav = document.querySelector('#site-nav');

  const updateHeader = () => header?.classList.toggle('is-scrolled', window.scrollY > 8);
  updateHeader();
  window.addEventListener('scroll', updateHeader, { passive: true });

  navToggle?.addEventListener('click', () => {
    const isOpen = navToggle.getAttribute('aria-expanded') === 'true';
    navToggle.setAttribute('aria-expanded', String(!isOpen));
    nav?.classList.toggle('is-open', !isOpen);
  });

  nav?.querySelectorAll('a').forEach((link) => {
    link.addEventListener('click', () => {
      navToggle?.setAttribute('aria-expanded', 'false');
      nav?.classList.remove('is-open');
    });
  });

  const githubStarCount = document.querySelector('[data-github-star-count]');
  const githubStarStatus = document.querySelector('[data-github-star-status]');

  const loadGithubStarCount = async () => {
    if (!githubStarCount) return;

    try {
      const response = await fetch('https://api.github.com/repos/UrbanGround/UrbanGround', {
        headers: { Accept: 'application/vnd.github+json' },
        cache: 'no-store'
      });
      if (!response.ok) return;

      const repository = await response.json();
      const stars = repository.stargazers_count;
      if (!Number.isSafeInteger(stars) || stars < 0) return;

      const formattedStars = new Intl.NumberFormat('en-US').format(stars);
      githubStarCount.textContent = formattedStars;
      if (githubStarStatus) {
        githubStarStatus.textContent = `GitHub star count: ${formattedStars}.`;
      }
    } catch {
      // Keep the visible em dash and accessible fallback when the API is unavailable.
    }
  };

  void loadGithubStarCount();

  const playStage = document.querySelector('[data-play-stage]');
  const playStart = document.querySelector('[data-play-start]');
  const playExit = document.querySelector('[data-play-exit]');
  const controlModes = [...document.querySelectorAll('[data-control-mode]')];
  const agentForm = document.querySelector('[data-agent-form]');
  const agentStatus = document.querySelector('[data-agent-status]');
  const agentStop = document.querySelector('[data-agent-stop]');
  const agentInstructionField = document.querySelector('[data-agent-instruction-field]');
  const taskLoad = document.querySelector('[data-task-load]');
  const taskClose = document.querySelector('[data-task-close]');
  const taskBrowser = document.querySelector('[data-task-browser]');
  const taskGroups = document.querySelector('[data-task-groups]');
  const taskSelection = document.querySelector('[data-task-selection]');
  const taskPreview = document.querySelector('[data-task-preview]');
  const taskPreviewTitle = document.querySelector('[data-task-preview-title]');
  const taskPreviewPrompt = document.querySelector('[data-task-preview-prompt]');
  const taskClear = document.querySelector('[data-task-clear]');
  const desktopNotice = document.querySelector('[data-desktop-notice]');
  const desktopNoticeClose = document.querySelector('[data-desktop-notice-close]');
  let gameStarted = false;
  let gameFrame = null;
  let unityReady = false;
  let pendingAgentConfig = null;
  let pendingTaskCatalog = false;
  let selectedTask = null;
  let agentActive = false;
  let exitingGame = false;
  const bridgeNamespace = 'urbanground';
  const bridgeType = (suffix) => `${bridgeNamespace}:${suffix}`;
  const acceptBridgeMessage = (type, suffix) => type === bridgeType(suffix);

  const capabilityNames = [
    'Local Environment Understanding',
    'Navigation under Explicit Instructions',
    'Exploration under Implicit Instructions',
    'Multi-Task Planning',
    'Dynamic Environment Interaction'
  ];

  const isMobileDevice = () => {
    if (navigator.userAgentData?.mobile) return true;
    if (/Android|iPhone|iPad|iPod|Mobile|IEMobile|Opera Mini/i.test(navigator.userAgent)) return true;
    return navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1;
  };

  const requestDesktop = () => {
    if (!isMobileDevice()) return false;
    if (desktopNotice?.showModal) desktopNotice.showModal();
    else window.alert('UrbanGround requires a desktop computer. Please open this page on a desktop browser to play.');
    return true;
  };

  const setAgentStatus = (message) => {
    if (agentStatus) agentStatus.textContent = message;
  };

  const setAgentActive = (active) => {
    agentActive = active;
    if (agentStop) agentStop.disabled = !active;
    playStage?.classList.toggle('is-agent-controlled', active);
  };

  const postBridgeMessage = (suffix, payload, requireReady = true) => {
    if (!gameFrame?.contentWindow || (requireReady && !unityReady)) return false;
    gameFrame.contentWindow.postMessage({
      type: bridgeType(suffix),
      ...(payload || {})
    }, window.location.origin);
    return true;
  };

  const sendAgentMessage = (suffix, config) => postBridgeMessage(suffix, config);

  const setBenchmarkMode = (active) => {
    if (agentInstructionField) agentInstructionField.hidden = active;
  };

  const clearTaskSelection = (notifyUnity = false) => {
    selectedTask = null;
    setBenchmarkMode(false);
    if (taskSelection) taskSelection.textContent = 'No task selected · free exploration';
    if (taskPreview) taskPreview.hidden = true;
    taskGroups?.querySelectorAll('select').forEach((select) => { select.value = ''; });
    if (notifyUnity) sendAgentMessage('task-clear');
  };

  const requestTaskCatalog = () => {
    pendingTaskCatalog = true;
    setAgentStatus('Loading the experimental task library…');
    startEmbeddedGame();
    if (sendAgentMessage('task-catalog-request')) pendingTaskCatalog = false;
  };

  const renderTaskCatalog = (catalog) => {
    if (!taskGroups || !catalog?.ok || !Array.isArray(catalog.tasks)) return;
    taskGroups.replaceChildren();

    for (let level = 1; level <= 5; level += 1) {
      const tasks = catalog.tasks.filter((task) => task.level === level);
      const levelDetails = document.createElement('details');
      levelDetails.className = 'agent-task-level';
      const levelSummary = document.createElement('summary');
      levelSummary.textContent = `Level ${level} · ${capabilityNames[level - 1]} (${tasks.length})`;
      levelDetails.appendChild(levelSummary);

      const typeGrid = document.createElement('div');
      typeGrid.className = 'agent-task-types';
      const types = [...new Set(tasks.map((task) => task.type))];
      types.forEach((type) => {
        const typeTasks = tasks.filter((task) => task.type === type);
        const label = document.createElement('label');
        label.className = 'agent-task-type';
        const name = document.createElement('span');
        name.textContent = `${type} (${typeTasks.length})`;
        const select = document.createElement('select');
        select.setAttribute('aria-label', `Choose a ${type} task`);
        const empty = document.createElement('option');
        empty.value = '';
        empty.textContent = 'Choose task…';
        select.appendChild(empty);

        typeTasks.forEach((task) => {
          const option = document.createElement('option');
          option.value = task.entry_id;
          option.textContent = task.display_id || task.entry_id;
          select.appendChild(option);
        });

        select.addEventListener('change', () => {
          const chosen = typeTasks.find((task) => task.entry_id === select.value);
          if (!chosen) return;
          taskGroups.querySelectorAll('select').forEach((other) => {
            if (other !== select) other.value = '';
          });
          selectedTask = chosen;
          setBenchmarkMode(true);
          if (taskSelection) taskSelection.textContent = `${chosen.display_id || chosen.entry_id} · ${chosen.type}`;
          if (taskPreview) taskPreview.hidden = false;
          if (taskPreviewTitle) taskPreviewTitle.textContent = `${chosen.display_id || chosen.entry_id} · ${chosen.type}`;
          if (taskPreviewPrompt) taskPreviewPrompt.textContent = 'Loading task instructions…';
          sendAgentMessage('task-detail-request', { entryId: chosen.entry_id });
          setAgentStatus('Task selected. Confirm to load it and start the agent.');
        });

        label.append(name, select);
        typeGrid.appendChild(label);
      });

      levelDetails.appendChild(typeGrid);
      taskGroups.appendChild(levelDetails);
    }

    taskLoad?.classList.add('has-catalog');
    if (taskLoad) taskLoad.textContent = 'Tasks Loaded';
    setAgentStatus('Choose an evaluation task, or continue with free exploration.');
  };

  const selectControlMode = (mode) => {
    const useAgent = mode === 'agent';
    controlModes.forEach((button) => {
      const active = button.dataset.controlMode === mode;
      button.classList.toggle('is-active', active);
      button.setAttribute('aria-pressed', String(active));
    });
    if (agentForm) agentForm.hidden = !useAgent;

    if (!useAgent) {
      if (gameFrame?.contentWindow && !exitingGame) postBridgeMessage('agent-stop', null, false);
      pendingAgentConfig = null;
      setAgentActive(false);
      agentForm?.reset();
      clearTaskSelection();
      setAgentStatus('The API key is sent only to the API URL you provide.');
    }
  };

  const startEmbeddedGame = () => {
    if (!playStage || gameStarted) return;
    if (!crossOriginIsolated) {
      sessionStorage.setItem('urbangroundStartAfterReload', '1');
      window.location.reload();
      return;
    }

    gameStarted = true;
    exitingGame = false;
    sessionStorage.removeItem('urbangroundStartAfterReload');
    playStage.classList.add('is-loading');
    playStart?.setAttribute('aria-busy', 'true');
    if (playExit) playExit.hidden = false;

    gameFrame = document.createElement('iframe');
    gameFrame.className = 'play-frame';
    gameFrame.title = 'UrbanGround interactive Unity sandbox';
    gameFrame.src = 'play/?v=20260817c';
    gameFrame.allow = 'fullscreen; gamepad';
    gameFrame.setAttribute('allowfullscreen', '');
    gameFrame.addEventListener('load', () => {
      playStage.classList.remove('is-loading');
      playStage.classList.add('is-playing');
    });

    playStage.replaceChildren(gameFrame);
    gameFrame.focus();
  };

  const exitEmbeddedGame = () => {
    if (!gameStarted || exitingGame) return;
    exitingGame = true;
    const closingFrame = gameFrame;
    postBridgeMessage('agent-stop', null, false);
    pendingAgentConfig = null;
    pendingTaskCatalog = false;
    setAgentActive(false);
    selectControlMode('human');
    if (agentForm) agentForm.elements.apiKey.value = '';
    if (taskBrowser) taskBrowser.hidden = true;
    taskGroups?.replaceChildren();
    taskLoad?.classList.remove('has-catalog');
    if (taskLoad) {
      taskLoad.textContent = 'Load Tasks';
      taskLoad.setAttribute('aria-expanded', 'false');
    }
    if (playExit) playExit.hidden = true;

    window.setTimeout(() => {
      if (gameFrame !== closingFrame) return;
      gameFrame = null;
      unityReady = false;
      gameStarted = false;
      playStage?.classList.remove('is-loading', 'is-playing', 'is-agent-controlled');
      playStart?.removeAttribute('aria-busy');
      if (playStage && playStart) playStage.replaceChildren(playStart);
      exitingGame = false;
      playStart?.focus();
    }, 120);
  };

  playStart?.addEventListener('click', () => {
    if (!requestDesktop()) startEmbeddedGame();
  });
  playExit?.addEventListener('click', exitEmbeddedGame);
  desktopNoticeClose?.addEventListener('click', () => desktopNotice?.close());

  taskLoad?.addEventListener('click', () => {
    if (requestDesktop()) return;
    const opening = taskBrowser?.hidden !== false;
    if (taskBrowser) taskBrowser.hidden = !opening;
    taskLoad.setAttribute('aria-expanded', String(opening));
    if (opening && !taskLoad.classList.contains('has-catalog')) requestTaskCatalog();
  });
  taskClose?.addEventListener('click', () => {
    if (taskBrowser) taskBrowser.hidden = true;
    taskLoad?.setAttribute('aria-expanded', 'false');
  });
  taskClear?.addEventListener('click', () => {
    clearTaskSelection(true);
    setAgentStatus('Free exploration selected. Confirm to start the agent.');
  });

  controlModes.forEach((button) => {
    button.addEventListener('click', () => {
      const mode = button.dataset.controlMode;
      if (mode === 'agent' && requestDesktop()) return;
      if (mode === 'agent' && !crossOriginIsolated) {
        sessionStorage.setItem('urbangroundControlAfterReload', 'agent');
        startEmbeddedGame();
        return;
      }
      selectControlMode(mode);
      if (mode === 'agent') agentForm?.querySelector('input')?.focus();
    });
  });

  agentForm?.addEventListener('submit', (event) => {
    event.preventDefault();
    if (!agentForm.reportValidity()) return;

    const formData = new FormData(agentForm);
    const endpoint = String(formData.get('endpoint') || '').trim();
    const apiKey = String(formData.get('apiKey') || '');
    const model = String(formData.get('model') || '').trim();
    const instruction = String(formData.get('instruction') || '').trim();
    const effectiveInstruction = selectedTask ? '' : instruction;
    let endpointUrl;
    try {
      endpointUrl = new URL(endpoint);
    } catch {
      agentForm.elements.endpoint.setCustomValidity('Enter a complete API URL.');
      agentForm.reportValidity();
      return;
    }
    if (!['http:', 'https:'].includes(endpointUrl.protocol)) {
      agentForm.elements.endpoint.setCustomValidity('Use an HTTP or HTTPS API URL.');
      agentForm.reportValidity();
      return;
    }
    agentForm.elements.endpoint.setCustomValidity('');

    pendingAgentConfig = {
      endpoint: endpointUrl.href,
      apiKey,
      model,
      instruction: effectiveInstruction,
      taskId: selectedTask?.entry_id || ''
    };
    if (agentStop) agentStop.disabled = false;
    setAgentStatus(gameStarted ? 'Waiting for UrbanGround to finish loading…' : 'Starting UrbanGround…');
    startEmbeddedGame();
    if (sendAgentMessage('agent-start', pendingAgentConfig)) {
      pendingAgentConfig = null;
      agentForm.elements.apiKey.value = '';
      setAgentStatus(selectedTask ? 'Loading the selected task…' : 'Agent is preparing its exploration.');
    }
  });

  agentStop?.addEventListener('click', () => {
    pendingAgentConfig = null;
    sendAgentMessage('agent-stop');
    if (agentForm) agentForm.elements.apiKey.value = '';
    setAgentActive(false);
    setAgentStatus('Agent stopped.');
  });

  let instructionTimer = 0;
  agentForm?.elements.instruction?.addEventListener('input', () => {
    if (!agentActive || selectedTask) return;
    window.clearTimeout(instructionTimer);
    instructionTimer = window.setTimeout(() => {
      sendAgentMessage('agent-instruction', {
        instruction: String(agentForm.elements.instruction.value || '').trim()
      });
      setAgentStatus('Instruction updated for the next agent step.');
    }, 180);
  });

  window.addEventListener('message', (event) => {
    if (event.origin !== window.location.origin || event.source !== gameFrame?.contentWindow) return;
    if (exitingGame) return;
    if (acceptBridgeMessage(event.data?.type, 'unity-ready')) {
      unityReady = true;
      if (pendingTaskCatalog && sendAgentMessage('task-catalog-request')) {
        pendingTaskCatalog = false;
      }
      if (pendingAgentConfig && sendAgentMessage('agent-start', pendingAgentConfig)) {
        pendingAgentConfig = null;
        if (agentForm) agentForm.elements.apiKey.value = '';
        setAgentStatus(selectedTask ? 'Loading the selected task…' : 'Agent is preparing its exploration.');
      }
      return;
    }
    if (acceptBridgeMessage(event.data?.type, 'task-catalog')) {
      renderTaskCatalog(event.data.catalog);
      return;
    }
    if (acceptBridgeMessage(event.data?.type, 'task-detail')) {
      const detail = event.data.detail;
      if (detail?.ok && selectedTask?.entry_id === detail.entry_id && taskPreviewPrompt) {
        taskPreviewPrompt.textContent = detail.prompt;
      }
      return;
    }
    if (acceptBridgeMessage(event.data?.type, 'agent-state')) {
      if (event.data.state === 'running') {
        setAgentActive(true);
        setAgentStatus(selectedTask ? 'Agent has control and is working on the selected task.' : 'Agent has control and is exploring UrbanGround.');
      } else if (event.data.state === 'stopped') {
        setAgentActive(false);
        setAgentStatus('Agent stopped.');
      } else if (event.data.state === 'finished') {
        setAgentActive(false);
        setAgentStatus('Agent finished the run.');
      } else if (event.data.state === 'task-loaded') {
        setAgentStatus('Task loaded through the evaluation task runner.');
      } else if (event.data.state === 'error') {
        setAgentStatus(event.data.message || 'The model endpoint could not be reached.');
      }
    }
  });

  if (sessionStorage.getItem('urbangroundControlAfterReload') === 'agent') {
    selectControlMode('agent');
    if (crossOriginIsolated) sessionStorage.removeItem('urbangroundControlAfterReload');
  }
  if (sessionStorage.getItem('urbangroundStartAfterReload') === '1') {
    document.querySelector('#play-online')?.scrollIntoView({ block: 'center' });
    startEmbeddedGame();
  }

  const demoVideos = [...document.querySelectorAll('.demo-card video')];
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  const loadVideo = (video) => {
    if (video.dataset.loaded === 'true') return;
    const source = video.querySelector('source[data-src]');
    if (!source) return;
    source.src = source.dataset.src;
    video.dataset.loaded = 'true';
    video.load();
  };

  if ('IntersectionObserver' in window) {
    const videoObserver = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        const video = entry.target;
        if (entry.isIntersecting) {
          loadVideo(video);
          if (!reduceMotion) {
            video.play().catch(() => {
              video.addEventListener('canplay', () => video.play().catch(() => {}), { once: true });
            });
          }
        } else {
          video.pause();
        }
      });
    }, { rootMargin: '160px 0px', threshold: 0.1 });

    demoVideos.forEach((video) => videoObserver.observe(video));
  } else {
    demoVideos.forEach((video) => {
      loadVideo(video);
      if (!reduceMotion) video.play().catch(() => {});
    });
  }

  const figureButtons = [...document.querySelectorAll('[data-figure-src]')];
  const selectedImage = document.querySelector('[data-selected-image]');
  const selectedTitle = document.querySelector('[data-selected-title]');
  const selectedCaption = document.querySelector('[data-selected-caption]');

  figureButtons.forEach((button) => {
    const preload = new Image();
    preload.src = button.dataset.figureSrc;

    button.addEventListener('click', () => {
      if (!selectedImage) return;

      figureButtons.forEach((item) => {
        const active = item === button;
        item.classList.toggle('is-active', active);
        item.setAttribute('aria-pressed', String(active));
      });

      selectedImage.classList.add('is-changing');
      const applySelection = () => {
        selectedImage.src = button.dataset.figureSrc;
        selectedImage.alt = `Figure 2 panel: ${button.dataset.figureTitle}`;
        if (selectedTitle) selectedTitle.textContent = button.dataset.figureTitle;
        if (selectedCaption) selectedCaption.textContent = button.dataset.figureCaption;
        requestAnimationFrame(() => selectedImage.classList.remove('is-changing'));
      };

      window.setTimeout(applySelection, 90);
    });
  });

})();
