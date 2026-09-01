// plugins/metadata/youtube_playlist/settings.js
(function () {
    console.log('[YouTubePlaylistSettings] Initing script for pluginId:', pluginId, 'root:', root);

    if (!root) return;

    const jsonInput = root.querySelector('.yt-playlists-json-input');
    const rowsContainer = root.querySelector('.yt-playlist-rows-container');
    const addBtn = root.querySelector('.yt-add-btn');
    const countBadge = root.querySelector('.yt-settings-count-badge');
    const filterInput = root.querySelector('.yt-settings-filter-input');
    const bulkToggleBtn = root.querySelector('.yt-bulk-toggle-btn');
    const bulkPanel = root.querySelector('.yt-bulk-panel');
    const bulkTextarea = root.querySelector('.yt-bulk-textarea');
    const bulkApplyBtn = root.querySelector('.yt-bulk-apply-btn');
    const bulkCancelBtn = root.querySelector('.yt-bulk-cancel-btn');

    if (!rowsContainer || !addBtn || !jsonInput) {
        console.warn('[YouTubePlaylistSettings] Required container elements missing in root:', root);
        return;
    }

    // i18n Dictionary
    const i18nDictSettings = {
        ko: {
            registeredPlaylists: "등록된 플레이리스트",
            addPlaylist: "플레이리스트 추가",
            bulkImport: "일괄 등록",
            filterPlaceholder: "등록된 플레이리스트 검색...",
            bulkTitle: "일괄 등록 (1줄에 1개씩 입력)",
            bulkFormatHelp: "형식: URL/ID | 별칭(선택) | 일반/성인(선택 - 생략시 일반)",
            bulkPlaceholder: "유튜브 플레이리스트 URL 또는 ID를 한 줄에 하나씩 입력하세요...\n예시:\nhttps://www.youtube.com/playlist?list=PL123 (일반 보관함, 자동 제목)\nPL456 | 개발 강좌 (일반 보관함, 별칭 지정)\nPL789 | 성인 (성인 보관함)\nPL999 | 음악 영상 | 성인",
            applyBulk: "일괄 추가",
            cancel: "취소",
            urlHelp: "유튜브 공개 또는 일부 공개 플레이리스트 URL(예: https://www.youtube.com/playlist?list=PL...) 또는 Playlist ID(PL...)를 입력하세요.",
            scanInterval: "백그라운드 스캔 & SQLite DB 캐시 갱신 주기",
            scanHelp: "백그라운드에서 지정된 시간 간격으로 새 영상 목록을 자동 수집하며, 라이브러리 접속 시에는 SQLite DB 캐시에서 0.01초 만에 즉시 로딩됩니다.",
            urlPlaceholder: "플레이리스트 URL 또는 ID (예: PL...)",
            namePlaceholder: "별칭/시리즈 제목 (선택)",
            autoTitleLabel: "자동 타이틀",
            generalLibrary: "🟢 일반 보관함",
            adultLibrary: "🔞 성인 보관함",
            otherOptions: "기타 옵션",
            autoPlay: "영상 선택 시 플레이어에서 자동 재생",
            miniPlayer: "미니 플레이어 사용 (별도 플로팅 창으로 영상 재생)",
            deleteTitle: "삭제",
            interval1h: "1시간 마다",
            interval3h: "3시간 마다",
            interval6h: "6시간 마다 (권장)",
            interval12h: "12시간 마다",
            interval24h: "24시간 마다",
            interval0h: "수동 새로고침만 사용"
        },
        en: {
            registeredPlaylists: "Registered Playlists",
            addPlaylist: "Add Playlist",
            bulkImport: "Bulk Import",
            filterPlaceholder: "Search registered playlists...",
            bulkTitle: "Bulk Import Playlists (One per line)",
            bulkFormatHelp: "Format: URL/ID | Title(Optional) | General/Adult(Optional - Default General)",
            bulkPlaceholder: "Paste playlist URLs or IDs (one per line)...\nExample:\nhttps://www.youtube.com/playlist?list=PL123 (General library, auto title)\nPL456 | Development Course (General library, custom title)\nPL789 | adult (Adult library)\nPL999 | Music Video | adult",
            applyBulk: "Add All",
            cancel: "Cancel",
            urlHelp: "Enter public or unlisted YouTube playlist URL (e.g. https://www.youtube.com/playlist?list=PL...) or Playlist ID (PL...).",
            scanInterval: "Background Scan & SQLite Cache Refresh Interval",
            scanHelp: "Automatically fetches new videos in background at specified intervals. Loads instantly in 0.01s from SQLite DB cache on library access.",
            urlPlaceholder: "Playlist URL or ID (e.g. PL...)",
            namePlaceholder: "Custom Title (Optional)",
            autoTitleLabel: "Auto Title",
            generalLibrary: "🟢 General Library",
            adultLibrary: "🔞 Adult Library",
            otherOptions: "Other Options",
            autoPlay: "Autoplay video on selection",
            miniPlayer: "Use mini player (play video in a separate floating window)",
            deleteTitle: "Delete",
            interval1h: "Every 1 hour",
            interval3h: "Every 3 hours",
            interval6h: "Every 6 hours (Recommended)",
            interval12h: "Every 12 hours",
            interval24h: "Every 24 hours",
            interval0h: "Manual Refresh Only"
        }
    };

    function getLang() {
        const lang = document.documentElement.lang || navigator.language || 'en';
        return String(lang).toLowerCase().startsWith('ko') ? 'ko' : 'en';
    }

    function t(key) {
        const lang = getLang();
        return (i18nDictSettings[lang] && i18nDictSettings[lang][key]) || (i18nDictSettings['en'] && i18nDictSettings['en'][key]) || (i18nDictSettings['ko'] && i18nDictSettings['ko'][key]) || key;
    }

    function applyI18nDOMSettings() {
        root.querySelectorAll('[data-i18n]').forEach(el => {
            const key = el.getAttribute('data-i18n');
            if (key) el.textContent = t(key);
        });
        root.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
            const key = el.getAttribute('data-i18n-placeholder');
            if (key) el.placeholder = t(key);
        });
    }

    applyI18nDOMSettings();

    // 저장된 설정(config) 값에 맞춰 체크박스 상태를 명시적으로 반영한다.
    // (코어 applyConfigValues 는 config 키가 없으면 HTML 기본 checked 를 건드리지
    //  않으므로, 여기서 config 를 기준으로 강제 설정한다.)
    function syncCheckboxesFromConfig() {
        try {
            const cfg = config || {};
            const sync = (name) => {
                const el = root.querySelector(`input[type="checkbox"][name="${name}"]`);
                if (!el) return;
                const val = cfg[name];
                // 명시 값이 있으면 반영, 없으면 true(기본)로
                const on = val === undefined || val === null
                    ? true
                    : !(String(val).toLowerCase() in { '0': 1, 'false': 1, 'no': 1, 'off': 1, '': 1 });
                el.checked = on;
            };
            sync('AUTO_PLAY');
            sync('MINI_PLAYER_ENABLED');
        } catch (e) {
            console.warn('[YouTubePlaylistSettings] checkboxes sync failed:', e);
        }
    }
    syncCheckboxesFromConfig();

    let titleMap = {};
    let origTitleMap = {};
    let videoTitlesMap = {};

    function extractPlaylistIdJS(urlOrId) {
        if (!urlOrId) return '';
        const match = String(urlOrId).match(/[?&]list=([^&]+)/);
        if (match && match[1]) return match[1];
        return String(urlOrId).replace(/^.*list=/, '').trim();
    }

    async function loadSeriesTitles() {
        try {
            const [r1, r2] = await Promise.all([
                fetch('/api/media/dashboard/widgets/youtube_playlist/data?type=general').then(r => r.json()).catch(() => null),
                fetch('/api/media/dashboard/widgets/youtube_playlist/data?type=adult').then(r => r.json()).catch(() => null)
            ]);
            [r1, r2].forEach(res => {
                if (res && res.success) {
                    const seriesList = (res.data && res.data.series) || res.series || [];
                    seriesList.forEach(s => {
                        if (s && s.id) {
                            const rawId = String(s.id).trim().toLowerCase();
                            const cleanId = extractPlaylistIdJS(rawId).toLowerCase();
                            const tVal = s.title || '';
                            const oVal = s.original_title || s.title || '';
                            const videoTexts = (s.videos || []).map(v => (v.title || '') + ' ' + (v.description || '')).join(' ').toLowerCase();

                            titleMap[rawId] = tVal;
                            titleMap[cleanId] = tVal;

                            origTitleMap[rawId] = oVal;
                            origTitleMap[cleanId] = oVal;

                            videoTitlesMap[rawId] = videoTexts;
                            videoTitlesMap[cleanId] = videoTexts;
                        }
                    });
                }
            });
            updateAllRowPlaceholders();
            const currentQuery = filterInput ? filterInput.value : '';
            if (currentQuery) {
                performSettingsFilter(currentQuery);
            }
        } catch (e) {
            console.warn('[YouTubePlaylistSettings] Title map load warning:', e);
        }
    }

    function updateRowPlaceholder(row) {
        const idInput = row.querySelector('.yt-id-input');
        const nameInput = row.querySelector('.yt-name-input');
        if (!idInput || !nameInput) return;

        const rawId = idInput.value.trim().toLowerCase();
        const cleanId = extractPlaylistIdJS(rawId).toLowerCase();
        const foundTitle = titleMap[cleanId] || titleMap[rawId];
        if (foundTitle) {
            nameInput.placeholder = foundTitle;
        } else {
            nameInput.placeholder = t('namePlaceholder');
        }
    }

    function updateAllRowPlaceholders() {
        rowsContainer.querySelectorAll('.yt-row-item').forEach(updateRowPlaceholder);
    }

    loadSeriesTitles();

    // Helper: update PLAYLISTS_JSON hidden input value and counter badge from active DOM rows
    function updateHiddenJson() {
        const rows = rowsContainer.querySelectorAll('.yt-row-item');
        const list = [];
        let validCount = 0;

        rows.forEach((r, idx) => {
            const badge = r.querySelector('.yt-row-badge');
            if (badge) badge.textContent = `#${idx + 1}`;

            const idInput = r.querySelector('.yt-id-input');
            const nameInput = r.querySelector('.yt-name-input');
            const dbSelect = r.querySelector('.yt-db-select');

            const idVal = idInput ? idInput.value.trim() : '';
            const nameVal = nameInput ? nameInput.value.trim() : '';
            const dbVal = dbSelect ? dbSelect.value : 'general';

            if (idVal) {
                validCount++;
                list.push({
                    id: idVal,
                    custom_name: nameVal,
                    target_db: dbVal
                });
            }
        });

        jsonInput.value = JSON.stringify(list);
        if (countBadge) countBadge.textContent = validCount;
    }

    // Create dynamic row element
    function createRow(idVal = '', nameVal = '', dbVal = 'general') {
        const row = document.createElement('div');
        row.className = 'yt-row-item';

        const isAdult = String(dbVal).toLowerCase() === 'adult';
        const rowCount = rowsContainer.querySelectorAll('.yt-row-item').length + 1;

        row.innerHTML = `
            <span class="yt-row-badge">#${rowCount}</span>
            <input type="text" class="yt-id-input" placeholder="${escapeHtmlAttr(t('urlPlaceholder'))}" value="${escapeHtmlAttr(idVal)}" style="flex: 1.5; min-width: 180px; background: rgba(30, 41, 59, 0.8); border: 1px solid rgba(255, 255, 255, 0.15); color: #fff; padding: 0.45rem 0.65rem; border-radius: 4px; font-size: 0.82rem; outline: none;">
            <input type="text" class="yt-name-input" placeholder="${escapeHtmlAttr(t('namePlaceholder'))}" value="${escapeHtmlAttr(nameVal)}" style="flex: 1; min-width: 130px; background: rgba(30, 41, 59, 0.8); border: 1px solid rgba(255, 255, 255, 0.15); color: #fff; padding: 0.45rem 0.65rem; border-radius: 4px; font-size: 0.82rem; outline: none;">
            <select class="yt-db-select" style="background: rgba(30, 41, 59, 0.8); border: 1px solid rgba(255, 255, 255, 0.15); color: #fff; padding: 0.45rem 0.65rem; border-radius: 4px; font-size: 0.82rem; outline: none; cursor: pointer;">
                <option value="general" ${!isAdult ? 'selected' : ''}>${escapeHtmlAttr(t('generalLibrary'))}</option>
                <option value="adult" ${isAdult ? 'selected' : ''}>${escapeHtmlAttr(t('adultLibrary'))}</option>
            </select>
            <button type="button" class="yt-remove-btn" title="${escapeHtmlAttr(t('deleteTitle'))}" style="background: none; border: 1px solid rgba(239, 68, 68, 0.4); color: #ef4444; padding: 0.4rem 0.6rem; font-size: 0.8rem; cursor: pointer; display: flex; align-items: center; justify-content: center; border-radius: 4px;">
                <i class="fa-solid fa-trash"></i>
            </button>
        `;

        // Listen for input and select changes
        row.querySelectorAll('input, select').forEach(inp => {
            inp.addEventListener('input', () => {
                updateHiddenJson();
                updateRowPlaceholder(row);
            });
            inp.addEventListener('change', () => {
                updateHiddenJson();
                updateRowPlaceholder(row);
            });
        });

        // Delete button listener
        row.querySelector('.yt-remove-btn').addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            row.remove();
            updateHiddenJson();
        });

        rowsContainer.appendChild(row);
        updateRowPlaceholder(row);
        updateHiddenJson();
    }

    function escapeHtmlAttr(str) {
        if (!str) return '';
        return String(str)
            .replace(/&/g, '&amp;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;');
    }

    // Add button click handler
    addBtn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        createRow('', '', 'general');
    });

    // Real-time Search Filter Handler
    function performSettingsFilter(queryStr) {
        const query = (queryStr || '').trim().toLowerCase();
        const rows = rowsContainer.querySelectorAll('.yt-row-item');

        rows.forEach(r => {
            const idInputVal = (r.querySelector('.yt-id-input')?.value || '').trim().toLowerCase();
            const cleanId = extractPlaylistIdJS(idInputVal).toLowerCase();
            const nameVal = (r.querySelector('.yt-name-input')?.value || '').trim().toLowerCase();
            const fetchedTitle = (titleMap[cleanId] || titleMap[idInputVal] || '').toLowerCase();
            const origTitle = (origTitleMap[cleanId] || origTitleMap[idInputVal] || '').toLowerCase();
            const videoTexts = videoTitlesMap[cleanId] || videoTitlesMap[idInputVal] || '';

            const matchId = idInputVal.includes(query);
            const matchName = nameVal.includes(query);
            const matchTitle = fetchedTitle.includes(query);
            const matchOrig = origTitle.includes(query);
            const matchVideo = videoTexts.includes(query);

            if (!query || matchId || matchName || matchTitle || matchOrig || matchVideo) {
                r.style.display = 'flex';
            } else {
                r.style.display = 'none';
            }
        });
    }

    if (filterInput) {
        ['input', 'keyup', 'change'].forEach(evt => {
            filterInput.addEventListener(evt, (e) => performSettingsFilter(e.target.value));
        });
    }

    // Root Event Delegation fallback
    ['input', 'keyup', 'change'].forEach(evt => {
        root.addEventListener(evt, (e) => {
            if (e.target && e.target.classList.contains('yt-settings-filter-input')) {
                performSettingsFilter(e.target.value);
            }
        });
    });

    // Bulk Import Toggle Handler
    if (bulkToggleBtn && bulkPanel) {
        bulkToggleBtn.addEventListener('click', (e) => {
            e.preventDefault();
            const isHidden = bulkPanel.style.display === 'none';
            bulkPanel.style.display = isHidden ? 'flex' : 'none';
            if (isHidden && bulkTextarea) bulkTextarea.focus();
        });
    }

    if (bulkCancelBtn && bulkPanel) {
        bulkCancelBtn.addEventListener('click', (e) => {
            e.preventDefault();
            bulkPanel.style.display = 'none';
        });
    }

    // Bulk Import Apply Handler
    if (bulkApplyBtn && bulkTextarea) {
        bulkApplyBtn.addEventListener('click', (e) => {
            e.preventDefault();
            const text = bulkTextarea.value.trim();
            if (!text) return;

            const lines = text.split('\n');
            let addedCount = 0;

            lines.forEach(line => {
                const parts = line.split('|').map(p => p.trim());
                const urlOrId = parts[0] || '';
                if (!urlOrId) return;

                let customTitle = '';
                let targetDb = 'general';

                if (parts.length >= 3) {
                    // Format: URL | Title | Library (General/Adult)
                    customTitle = parts[1] || '';
                    const dbStr = (parts[2] || '').toLowerCase();
                    if (dbStr.includes('성인') || dbStr.includes('adult')) {
                        targetDb = 'adult';
                    }
                } else if (parts.length === 2) {
                    // Format: URL | Title OR URL | Library
                    const part2Lower = parts[1].toLowerCase();
                    if (part2Lower === '성인' || part2Lower === 'adult') {
                        targetDb = 'adult';
                        customTitle = '';
                    } else if (part2Lower === '일반' || part2Lower === 'general') {
                        targetDb = 'general';
                        customTitle = '';
                    } else {
                        customTitle = parts[1];
                        targetDb = 'general';
                    }
                }

                createRow(urlOrId, customTitle, targetDb);
                addedCount++;
            });

            if (addedCount > 0) {
                bulkTextarea.value = '';
                bulkPanel.style.display = 'none';
            }
        });
    }

    // Load initial playlist items from config
    let initialList = [];
    if (config && config.PLAYLISTS_JSON) {
        try {
            initialList = typeof config.PLAYLISTS_JSON === 'string' ? JSON.parse(config.PLAYLISTS_JSON) : config.PLAYLISTS_JSON;
        } catch (e) {
            initialList = [];
        }
    }

    rowsContainer.innerHTML = '';
    if (Array.isArray(initialList) && initialList.length > 0) {
        initialList.forEach(item => {
            if (typeof item === 'string') {
                createRow(item, '', 'general');
            } else if (item && typeof item === 'object') {
                createRow(item.id || '', item.custom_name || '', item.target_db || 'general');
            }
        });
    } else {
        // 빈 설정은 실제 샘플 ID를 저장하지 않고 입력용 빈 행만 표시한다.
        createRow('', '', 'general');
    }
})();
