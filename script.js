// plugins/metadata/youtube_playlist/script.js

(function () {
    console.log('[YouTubePlaylistPlugin] Initializing YouTube Playlist UI...');

    let pluginData = null;
    let currentSeries = null;
    let currentVideoIndex = -1;
    let lastLoadedDbType = null;
    let isFetching = false;
    let activePlayerType = 'modal'; // 'modal' or 'inline'
    let modalPlayer = null;  // YT.Player instance (desktop modal)
    let inlinePlayer = null; // YT.Player instance (mobile inline)

    // Video list filter state
    let videoSearchQuery = '';
    let videoSortKey = 'none';   // 'none' | 'view' | 'date'
    let videoSortAsc = true;     // true = ascending (default), false = descending



    // i18n Dictionary
    const i18nDict = {
        ko: {
            subtitle: "등록된 유튜브 플레이리스트 목록 & 영상 스트리밍",
            searchPlaceholder: "플레이리스트 또는 영상 제목 검색...",
            refreshAll: "전체 새로고침",
            backToSeries: "전체 플레이리스트 목록",
            loading: "YouTube 플레이리스트 데이터를 불러오는 중입니다...",
            emptyTitle: "등록된 유튜브 플레이리스트가 없습니다.",
            emptyDesc: "[환경설정] ⚙️ -> [플러그인 설정] -> [Youtube Playlist]에서 플레이리스트 URL/ID를 등록해주세요.",
            playlists: "플레이리스트",
            seriesCountBadge: "{n}개 플레이리스트",
            episodesList: "에피소드 영상 목록",
            videosCountBadge: "{n}개 영상",
            refreshPlaylist: "플레이리스트 새로고침",
            prev: "이전",
            next: "다음",
            prevEpisode: "이전 회차",
            nextEpisode: "다음 회차",
            openYoutubeApp: "YouTube 앱으로 보기",
            openYoutubeWeb: "YouTube에서 보기",
            noVideos: "등록된 영상이 없습니다.",
            noDescription: "영상 설명이 없습니다.",
            singleRefreshTitle: "이 플레이리스트만 새로고침",
            noSearchResults: "'{q}'에 대한 검색 결과가 없습니다.",
            videoSearchPlaceholder: "영상 제목 검색...",
            sortDefault: "기본 순서",
            sortByViews: "조회수",
            sortByDate: "업로드 날짜",
            sortDirAsc: "오름차순",
            sortDirDesc: "내림차순",
            noFilteredVideos: "조건에 맞는 영상이 없습니다.",
            viewCountText: "조회수 {n}"
        },
        en: {
            subtitle: "Registered YouTube playlists & video streaming",
            searchPlaceholder: "Search playlist or video title...",
            refreshAll: "Refresh All",
            backToSeries: "All Playlists",
            loading: "Loading YouTube playlist data...",
            emptyTitle: "No registered YouTube playlists found.",
            emptyDesc: "Please add playlist URL/ID in [Settings] ⚙️ -> [Plugin Settings] -> [Youtube Playlist].",
            playlists: "Playlists",
            seriesCountBadge: "{n} Playlists",
            episodesList: "Episode Video List",
            videosCountBadge: "{n} Videos",
            refreshPlaylist: "Refresh Playlist",
            prev: "Prev",
            next: "Next",
            prevEpisode: "Previous",
            nextEpisode: "Next",
            openYoutubeApp: "Watch on YouTube App",
            openYoutubeWeb: "Watch on YouTube",
            noVideos: "No videos found.",
            noDescription: "No description.",
            singleRefreshTitle: "Refresh this playlist only",
            noSearchResults: "No search results found for '{q}'.",
            videoSearchPlaceholder: "Search video title...",
            sortDefault: "Default order",
            sortByViews: "Views",
            sortByDate: "Upload date",
            sortDirAsc: "Ascending",
            sortDirDesc: "Descending",
            noFilteredVideos: "No videos match the criteria.",
            viewCountText: "{n} views"
        }
    };

    function getLang() {
        let lang = '';
        if (window.i18n && window.i18n.currentLang) {
            lang = window.i18n.currentLang;
        } else if (localStorage.getItem('bookoasis_lang')) {
            lang = localStorage.getItem('bookoasis_lang');
        } else if (document.cookie.includes('bookoasis_lang=')) {
            const m = document.cookie.match(/bookoasis_lang=([^;]+)/);
            if (m) lang = m[1];
        } else if (document.documentElement.lang) {
            lang = document.documentElement.lang;
        } else if (navigator.language) {
            lang = navigator.language;
        }
        return (lang || 'en').toLowerCase().startsWith('ko') ? 'ko' : 'en';
    }

    function t(key, vars = {}) {
        const lang = getLang();
        let text = (i18nDict[lang] && i18nDict[lang][key]) || (i18nDict['en'] && i18nDict['en'][key]) || (i18nDict['ko'] && i18nDict['ko'][key]) || key;
        Object.keys(vars).forEach(k => {
            text = text.replace(new RegExp(`\\{${k}\\}`, 'g'), vars[k]);
        });
        return text;
    }

    // 플러그인 i18n 적용 범위를 플러그인 컨테이너(.yt-container)로 한정.
    // document 전체를 스캔하면 코어 UI의 data-i18n 요소(키가 코어 사전 전용)를
    // 플러그인 사전에서 찾지 못해 키 문자열 그대로 덮어쓰는 문제 발생 (2026-08-12).
    function getPluginRoot() {
        return document.querySelector('.yt-container');
    }

    function applyI18nDOM() {
        const root = getPluginRoot();
        if (!root) return;
        root.querySelectorAll('[data-i18n]').forEach(el => {
            const key = el.getAttribute('data-i18n');
            if (key) el.textContent = t(key);
        });
        root.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
            const key = el.getAttribute('data-i18n-placeholder');
            if (key) el.placeholder = t(key);
        });
    }

    // DOM Elements
    const searchInput = document.getElementById('ytSearchInput');
    const refreshBtn = document.getElementById('ytRefreshBtn');
    const loadingState = document.getElementById('ytLoadingState');
    const emptyState = document.getElementById('ytEmptyState');
    const seriesView = document.getElementById('ytSeriesView');
    const videosView = document.getElementById('ytVideosView');
    const seriesGrid = document.getElementById('ytSeriesGrid');
    const videosGrid = document.getElementById('ytVideosGrid');
    const videoSearchInput = document.getElementById('ytVideoSearchInput');
    const videoSortSelect = document.getElementById('ytVideoSortSelect');
    const videoSortDirBtn = document.getElementById('ytVideoSortDirBtn');
    const breadcrumb = document.getElementById('ytBreadcrumb');
    const backToSeriesBtn = document.getElementById('ytBackToSeriesBtn');
    const currentSeriesTitle = document.getElementById('ytCurrentSeriesTitle');

    // Banner & Badges
    const seriesCountBadge = document.getElementById('ytSeriesCountBadge');
    const videosCountBadge = document.getElementById('ytVideosCountBadge');
    const bannerCover = document.getElementById('ytBannerCover');
    const bannerTitle = document.getElementById('ytBannerTitle');
    const bannerMeta = document.getElementById('ytBannerMeta');
    const seriesRefreshBtn = document.getElementById('ytSeriesRefreshBtn');

    // Desktop Modal Player
    const playerModal = document.getElementById('ytPlayerModal');
    const modalSeriesName = document.getElementById('ytModalSeriesName');
    const modalVideoTitle = document.getElementById('ytModalVideoTitle');
    const modalPubDate = document.getElementById('ytModalPubDate');
    const modalExternalLink = document.getElementById('ytModalExternalLink');
    const modalDescription = document.getElementById('ytModalDescription');
    const modalCloseBtn = document.getElementById('ytModalCloseBtn');
    const prevVideoBtn = document.getElementById('ytPrevVideoBtn');
    const nextVideoBtn = document.getElementById('ytNextVideoBtn');

    // Mobile Sticky Top Inline Player
    const inlinePlayerContainer = document.getElementById('ytInlinePlayerContainer');
    const inlineSeriesBadge = document.getElementById('ytInlineSeriesBadge');
    const inlineVideoTitle = document.getElementById('ytInlineVideoTitle');
    const inlineExternalLink = document.getElementById('ytInlineExternalLink');
    const inlineCloseBtn = document.getElementById('ytInlineCloseBtn');
    const inlinePrevBtn = document.getElementById('ytInlinePrevBtn');
    const inlineNextBtn = document.getElementById('ytInlineNextBtn');



    // Detect active library type ('general' vs 'adult')
    function getActiveDbType() {
        if (window.currentLibraryType) {
            return window.currentLibraryType;
        }
        if (window.state && window.state.currentLibraryType) {
            return window.state.currentLibraryType;
        }
        const activeMenu = document.querySelector('.sidebar .menu-item.active, nav .menu-item.active');
        if (activeMenu && activeMenu.dataset && activeMenu.dataset.type) {
            const t = activeMenu.dataset.type;
            if (t === 'adult' || t === 'general') return t;
        }
        const urlParams = new URLSearchParams(window.location.search);
        if (urlParams.get('type')) {
            return urlParams.get('type');
        }
        if (localStorage.getItem('currentLibraryType')) {
            return localStorage.getItem('currentLibraryType');
        }
        return 'general';
    }

    // Is Mobile Device View
    function isMobileView() {
        return window.innerWidth <= 768;
    }

    // Fetch Playlist Data from Backend (strictly matching active db_type, loop-protected)
    async function loadData(force = false) {
        if (isFetching) return;

        const dbType = getActiveDbType();

        if (!force && lastLoadedDbType === dbType && pluginData) {
            return;
        }

        isFetching = true;
        showLoading(true);

        try {
            console.log(`[YouTubePlaylistPlugin] Fetching data for dbType: ${dbType}`);
            const resp = await fetch(`/api/media/dashboard/widgets/youtube_playlist/data?type=${encodeURIComponent(dbType)}`);
            const json = await resp.json();
            
            if (json.success) {
                pluginData = json.data || json;
                lastLoadedDbType = dbType;
                renderSeriesList(pluginData.series || []);
            } else {
                showEmpty(true);
            }
        } catch (err) {
            console.error('[YouTubePlaylistPlugin] Failed to load playlist data:', err);
            showEmpty(true);
        } finally {
            isFetching = false;
            showLoading(false);
        }
    }

    // Refresh Single Series On Demand
    async function refreshSingleSeries(seriesId, targetBtn = null) {
        if (!seriesId) return;
        const dbType = getActiveDbType();

        if (targetBtn) {
            targetBtn.disabled = true;
            targetBtn.classList.add('yt-spin-icon');
        }

        try {
            console.log(`[YouTubePlaylistPlugin] Refreshing single series ${seriesId}...`);
            const resp = await fetch(`/api/media/dashboard/widgets/youtube_playlist/data?type=${encodeURIComponent(dbType)}&refresh_series=${encodeURIComponent(seriesId)}`);
            const json = await resp.json();

            if (json.success && json.data) {
                pluginData = json.data;
                const updatedSeries = (pluginData.series || []).find(s => s.id === seriesId);

                if (updatedSeries && currentSeries && currentSeries.id === seriesId) {
                    currentSeries = updatedSeries;
                    bannerTitle.textContent = updatedSeries.title;
                    bannerCover.src = updatedSeries.cover;
                    bannerMeta.textContent = `${updatedSeries.item_count}개 영상 목록`;
                    renderVideosList();
                } else {
                    renderSeriesList(pluginData.series || []);
                }
            }
        } catch (err) {
            console.error('[YouTubePlaylistPlugin] Failed to refresh single series:', err);
        } finally {
            if (targetBtn) {
                targetBtn.disabled = false;
                targetBtn.classList.remove('yt-spin-icon');
            }
        }
    }

    // Render Series Grid (BookOasis Native Card UI + Quick Refresh)
    function renderSeriesList(seriesList, isSearch = false, query = '') {
        applyI18nDOM();

        if (!seriesList || seriesList.length === 0) {
            if (isSearch) {
                showEmpty(false);
                seriesView.style.display = 'block';
                videosView.style.display = 'none';
                breadcrumb.style.display = 'none';
                seriesCountBadge.textContent = t('seriesCountBadge', { n: 0 });
                seriesGrid.innerHTML = `
                    <div style="grid-column: 1 / -1; padding: 4rem 1rem; text-align: center; color: #94a3b8;">
                        <i class="fa-solid fa-magnifying-glass" style="font-size: 2.2rem; margin-bottom: 0.8rem; opacity: 0.4;"></i>
                        <div style="font-size: 0.95rem; font-weight: 600; color: #cbd5e1;">${escapeHtml(t('noSearchResults', { q: query }))}</div>
                    </div>
                `;
                return;
            } else {
                showEmpty(true);
                return;
            }
        }

        showEmpty(false);
        seriesGrid.innerHTML = '';
        seriesCountBadge.textContent = t('seriesCountBadge', { n: seriesList.length });

        seriesList.forEach((series) => {
            const card = document.createElement('div');
            card.className = 'book-card';
            card.innerHTML = `
                <div class="book-card-cover">
                    <img src="${escapeHtml(series.cover)}" alt="${escapeHtml(series.title)}" loading="lazy">
                    <div class="yt-card-play-overlay">
                        <div class="yt-card-play-icon"><i class="fa-solid fa-play"></i></div>
                    </div>
                    <span class="book-badge-count">${t('videosCountBadge', { n: series.item_count })}</span>
                    <button class="yt-card-single-refresh-btn" title="${escapeHtml(t('singleRefreshTitle'))}">
                        <i class="fa-solid fa-rotate-right"></i>
                    </button>
                </div>
                <div class="book-card-info">
                    <h4 class="book-card-title" title="${escapeHtml(series.title)}">${escapeHtml(series.title)}</h4>
                </div>
            `;

            // Individual Card Refresh Button
            const cardRefreshBtn = card.querySelector('.yt-card-single-refresh-btn');
            cardRefreshBtn.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                refreshSingleSeries(series.id, cardRefreshBtn);
            });

            card.addEventListener('click', () => openSeriesView(series));
            seriesGrid.appendChild(card);
        });

        switchView('series');
    }

    // Switch to Series Detail View (Videos List)
    function openSeriesView(series) {
        currentSeries = series;
        currentSeriesTitle.textContent = series.title;
        bannerTitle.textContent = series.title;
        bannerCover.src = series.cover;
        bannerMeta.textContent = t('videosCountBadge', { n: series.item_count });

        closeAllPlayers();
        renderVideosList();
        switchView('videos');
    }

    // Format view count for display (e.g. 7630000 -> 763만, 1234 -> 1,234)
    function formatViewCount(count) {
        const n = parseInt(count, 10) || 0;
        if (n >= 100000000) {
            const v = (n / 100000000).toFixed(1).replace(/\.0$/, '');
            return `${v}억`;
        }
        if (n >= 10000) {
            const v = (n / 10000).toFixed(1).replace(/\.0$/, '');
            return `${v}만`;
        }
        if (n >= 1000) {
            return n.toLocaleString();
        }
        return n > 0 ? String(n) : '';
    }

    // Apply search filter + sort to videos, keeping original indices for playback
    function getFilteredVideos() {
        if (!currentSeries || !Array.isArray(currentSeries.videos)) return [];
        const query = (videoSearchQuery || '').trim().toLowerCase();
        let items = currentSeries.videos.map((v, idx) => ({ v, idx }));

        if (query) {
            items = items.filter(({ v }) => {
                const mt = (v.title || '').toLowerCase().includes(query);
                const md = (v.description || '').toLowerCase().includes(query);
                return mt || md;
            });
        }

        if (videoSortKey === 'view') {
            items.sort((a, b) => {
                const av = parseInt(a.v.view_count, 10) || 0;
                const bv = parseInt(b.v.view_count, 10) || 0;
                return videoSortAsc ? av - bv : bv - av;
            });
        } else if (videoSortKey === 'date') {
            items.sort((a, b) => {
                const ad = (a.v.published || '');
                const bd = (b.v.published || '');
                return videoSortAsc ? ad.localeCompare(bd) : bd.localeCompare(ad);
            });
        } else {
            // 기본 순서: 플레이리스트 원본 순번(idx) 기준 오름/내림 정렬
            items.sort((a, b) => videoSortAsc ? a.idx - b.idx : b.idx - a.idx);
        }
        return items;
    }

    // Render Videos Grid (BookOasis Native Card UI) with search filter + sort
    function renderVideosList() {
        applyI18nDOM();
        videosGrid.innerHTML = '';
        const items = getFilteredVideos();
        videosCountBadge.textContent = t('videosCountBadge', { n: items.length });

        if (items.length === 0) {
            const msg = (videoSearchQuery || videoSortKey !== 'none')
                ? t('noFilteredVideos') : t('noVideos');
            videosGrid.innerHTML = `<p class="yt-subtitle" style="grid-column: 1/-1; text-align: center; padding: 2rem;">${escapeHtml(msg)}</p>`;
            return;
        }

        items.forEach(({ v, idx }, displayIndex) => {
            const card = document.createElement('div');
            card.className = 'book-card';
            const viewText = formatViewCount(v.view_count);
            const viewBadge = viewText
                ? `<span class="yt-view-badge"><i class="fa-solid fa-eye"></i> ${escapeHtml(viewText)}</span>`
                : '';
            card.innerHTML = `
                <div class="book-card-cover">
                    <img src="${escapeHtml(v.thumbnail)}" alt="${escapeHtml(v.title)}" loading="lazy">
                    <div class="yt-card-play-overlay">
                        <div class="yt-card-play-icon"><i class="fa-solid fa-play"></i></div>
                    </div>
                    <span class="book-badge-count">#${idx + 1}</span>
                    ${viewBadge}
                </div>
                <div class="book-card-info">
                    <h4 class="book-card-title" title="${escapeHtml(v.title)}">${escapeHtml(v.title)}</h4>
                    <span class="book-card-author"><i class="fa-regular fa-calendar"></i> ${escapeHtml(v.published || '')}</span>
                </div>
            `;
            // Use original index so player next/prev follow the full playlist order
            card.addEventListener('click', () => playVideo(idx));
            videosGrid.appendChild(card);
        });
    }

    // Open Embedded Player (Mobile Sticky Top Player vs Desktop Modal Player)
    // YouTube IFrame API 기반: iframe src 교체 대신 같은 플레이어 인스턴스에서 loadVideoById 사용
    // → autoplay 정책(사용자 제스처 없는 새 iframe 로드 차단) 우회 + onStateChange 공식 콜백으로 자동 재생
    function playVideo(index) {
        if (!currentSeries || !currentSeries.videos || !currentSeries.videos[index]) return;

        currentVideoIndex = index;
        const video = currentSeries.videos[index];

        if (isMobileView()) {
            // --- MOBILE STICKY TOP INLINE PLAYER ---
            activePlayerType = 'inline';
            playerModal.style.display = 'none';
            if (modalPlayer) modalPlayer.stopVideo(); // stop desktop modal player

            inlineSeriesBadge.textContent = `${currentSeries.title} (${index + 1}/${currentSeries.videos.length})`;
            inlineVideoTitle.textContent = video.title;
            inlineExternalLink.href = video.url;

            inlinePlayerContainer.style.display = 'block';
            if (inlinePlayer && video.id) {
                inlinePlayer.loadVideoById(video.id);
            }

            inlinePrevBtn.disabled = index <= 0;
            inlineNextBtn.disabled = index >= currentSeries.videos.length - 1;

            // Scroll top player into view smoothly
            inlinePlayerContainer.scrollIntoView({ behavior: 'smooth', block: 'start' });

        } else {
            // --- DESKTOP MODAL PLAYER ---
            activePlayerType = 'modal';
            inlinePlayerContainer.style.display = 'none';
            if (inlinePlayer) inlinePlayer.stopVideo(); // stop mobile inline player

            modalSeriesName.textContent = `${currentSeries.title} (${index + 1}/${currentSeries.videos.length})`;
            modalVideoTitle.textContent = video.title;
            modalPubDate.innerHTML = `<i class="fa-regular fa-calendar"></i> ${escapeHtml(video.published || '')}`;
            modalExternalLink.href = video.url;
            modalDescription.textContent = video.description || t('noDescription');

            playerModal.style.display = 'flex';

            // 같은 플레이어 인스턴스에서 영상 전환 (src 교체 없음)
            if (modalPlayer && video.id) {
                modalPlayer.loadVideoById(video.id);
            }

            prevVideoBtn.disabled = index <= 0;
            nextVideoBtn.disabled = index >= currentSeries.videos.length - 1;
        }
    }

    // Close Player Methods
    function closeAllPlayers() {
        if (modalPlayer) modalPlayer.stopVideo();
        if (inlinePlayer) inlinePlayer.stopVideo();
        playerModal.style.display = 'none';
        inlinePlayerContainer.style.display = 'none';
    }

    // IFrame API 준비 상태
    let apiReady = false;

    // new Function 스코프에서 실행되므로 window에 콜백을 명시적으로 등록해야 함
    window.onYouTubeIframeAPIReady = function () {
        apiReady = true;
        console.log('[YouTubePlaylistPlugin] IFrame API ready.');

        try {
            modalPlayer = new YT.Player('ytIframePlayer', {
                width: '100%',
                height: '100%',
                videoId: '',
                playerVars: {
                    autoplay: 1,
                    rel: 0
                },
                events: {
                    onStateChange: function (event) {
                        // 영상 종료(0) 감지 → 다음 영상 자동 재생
                        if (event.data === 0) {
                            if (currentSeries && currentSeries.videos) {
                                if (currentVideoIndex >= 0 && currentVideoIndex < currentSeries.videos.length - 1) {
                                    console.log(`[YouTubePlaylistPlugin] IFrameAPI: Video Ended. Autoplay next #${currentVideoIndex + 2}`);
                                    playVideo(currentVideoIndex + 1);
                                } else {
                                    console.log('[YouTubePlaylistPlugin] IFrameAPI: Last video ended. Stop.');
                                }
                            }
                        }
                    }
                }
            });

            inlinePlayer = new YT.Player('ytInlineIframePlayer', {
                width: '100%',
                height: '100%',
                videoId: '',
                playerVars: {
                    autoplay: 1,
                    rel: 0
                },
                events: {
                    onStateChange: function (event) {
                        if (event.data === 0) {
                            if (currentSeries && currentSeries.videos) {
                                if (currentVideoIndex >= 0 && currentVideoIndex < currentSeries.videos.length - 1) {
                                    console.log(`[YouTubePlaylistPlugin] IFrameAPI(inline): Video Ended. Autoplay next #${currentVideoIndex + 2}`);
                                    playVideo(currentVideoIndex + 1);
                                }
                            }
                        }
                    }
                }
            });
        } catch (err) {
            console.error('[YouTubePlaylistPlugin] IFrame API player init error:', err);
        }
    };

    // YouTube IFrame API 동적 로드 (index.html의 <script> 태그는 innerHTML 주입으로 실행되지 않으므로 JS에서 로드)
    function loadYouTubeIframeApi() {
        if (window.YT && window.YT.Player) {
            apiReady = true;
            return;
        }
        if (document.getElementById('yt-iframe-api-script')) return;
        const tag = document.createElement('script');
        tag.id = 'yt-iframe-api-script';
        tag.src = 'https://www.youtube.com/iframe_api';
        tag.async = true;
        document.head.appendChild(tag);
    }

    // View Switching
    function switchView(viewName) {
        if (viewName === 'series') {
            seriesView.style.display = 'block';
            videosView.style.display = 'none';
            breadcrumb.style.display = 'none';
            currentSeries = null;
            closeAllPlayers();
        } else if (viewName === 'videos') {
            seriesView.style.display = 'none';
            videosView.style.display = 'block';
            breadcrumb.style.display = 'flex';
        }
    }

    // Safe Library Toggle Listener (No loops, dbType check only)
    function attachSafeListeners() {
        const toggleButtons = document.querySelectorAll('#library-type-toggle-group .btn-toggle');
        toggleButtons.forEach(btn => {
            btn.addEventListener('click', () => {
                setTimeout(() => {
                    const currentDb = getActiveDbType();
                    if (currentDb !== lastLoadedDbType) {
                        console.log(`[YouTubePlaylistPlugin] Library switched to ${currentDb}, refetching...`);
                        loadData(true);
                    }
                }, 150);
            });
        });
    }

    // Helpers
    function showLoading(show) {
        loadingState.style.display = show ? 'block' : 'none';
        if (show) {
            seriesView.style.display = 'none';
            videosView.style.display = 'none';
            emptyState.style.display = 'none';
        }
    }

    function showEmpty(show) {
        emptyState.style.display = show ? 'block' : 'none';
        if (show) {
            seriesView.style.display = 'none';
            videosView.style.display = 'none';
        }
    }

    function escapeHtml(str) {
        if (!str) return '';
        return String(str)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    // Event Listeners
    refreshBtn.addEventListener('click', () => loadData(true));
    backToSeriesBtn.addEventListener('click', () => switchView('series'));

    // Series Banner Refresh Listener
    if (seriesRefreshBtn) {
        seriesRefreshBtn.addEventListener('click', (e) => {
            e.preventDefault();
            if (currentSeries) {
                refreshSingleSeries(currentSeries.id, seriesRefreshBtn);
            }
        });
    }

    // Modal Player Controls
    modalCloseBtn.addEventListener('click', closeAllPlayers);
    prevVideoBtn.addEventListener('click', () => {
        if (currentVideoIndex > 0) playVideo(currentVideoIndex - 1);
    });
    nextVideoBtn.addEventListener('click', () => {
        if (currentSeries && currentVideoIndex < currentSeries.videos.length - 1) {
            playVideo(currentVideoIndex + 1);
        }
    });

    // Inline Top Player Controls
    inlineCloseBtn.addEventListener('click', closeAllPlayers);
    inlinePrevBtn.addEventListener('click', () => {
        if (currentVideoIndex > 0) playVideo(currentVideoIndex - 1);
    });
    inlineNextBtn.addEventListener('click', () => {
        if (currentSeries && currentVideoIndex < currentSeries.videos.length - 1) {
            playVideo(currentVideoIndex + 1);
        }
    });



    // Close Modal on Backdrop Click or ESC
    playerModal.addEventListener('click', (e) => {
        if (e.target === playerModal) closeAllPlayers();
    });

    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            closeAllPlayers();
        }
    });

    // Real-time Search Filter (Searches Alias, Playlist Title, Original Title, and Episode Video Titles)
    function performSearch(queryStr) {
        const query = (queryStr || '').trim().toLowerCase();

        if (currentSeries) {
            // Inside video view: sync to dedicated video filter bar
            videoSearchQuery = queryStr || '';
            if (videoSearchInput) videoSearchInput.value = videoSearchQuery;
            renderVideosList();
            return;
        }

        if (!query) {
            if (pluginData && pluginData.series) {
                renderSeriesList(pluginData.series || []);
            }
            return;
        }

        if (pluginData && pluginData.series) {
            // Filter series list across Alias, Playlist Title, Original Title, and Episode Video Titles
            const filtered = pluginData.series.filter(s => {
                const matchTitle = (s.title || '').toLowerCase().includes(query);
                const matchCustom = (s.custom_name || '').toLowerCase().includes(query);
                const matchOrig = (s.original_title || '').toLowerCase().includes(query);
                const matchVideo = (s.videos || []).some(v => {
                    const vt = (v.title || '').toLowerCase();
                    const vd = (v.description || '').toLowerCase();
                    return vt.includes(query) || vd.includes(query);
                });
                return matchTitle || matchCustom || matchOrig || matchVideo;
            });
            renderSeriesList(filtered, true, queryStr.trim());
        }
    }

    if (searchInput) {
        searchInput.addEventListener('input', (e) => performSearch(e.target.value));
    }

    // Video list filter bar: dedicated search input
    if (videoSearchInput) {
        videoSearchInput.addEventListener('input', (e) => {
            videoSearchQuery = e.target.value;
            renderVideosList();
        });
    }

    // Video list sort select
    if (videoSortSelect) {
        videoSortSelect.addEventListener('change', (e) => {
            videoSortKey = e.target.value;
            renderVideosList();
        });
    }

    // Video list sort direction toggle (desc default, click -> asc)
    function updateSortDirBtn() {
        if (!videoSortDirBtn) return;
        const icon = videoSortDirBtn.querySelector('i');
        if (videoSortAsc) {
            videoSortDirBtn.classList.add('yt-sort-asc');
            if (icon) icon.className = 'fa-solid fa-arrow-up-short-wide';
            videoSortDirBtn.title = t('sortDirAsc');
        } else {
            videoSortDirBtn.classList.remove('yt-sort-asc');
            if (icon) icon.className = 'fa-solid fa-arrow-down-wide-short';
            videoSortDirBtn.title = t('sortDirDesc');
        }
    }

    if (videoSortDirBtn) {
        videoSortDirBtn.addEventListener('click', () => {
            videoSortAsc = !videoSortAsc;
            updateSortDirBtn();
            renderVideosList();
        });
    }

    // Reset filter state when leaving video view back to series list
    if (backToSeriesBtn) {
        backToSeriesBtn.addEventListener('click', () => {
            videoSearchQuery = '';
            videoSortKey = 'none';
            videoSortAsc = true;
            if (videoSearchInput) videoSearchInput.value = '';
            if (videoSortSelect) videoSortSelect.value = 'none';
            updateSortDirBtn();
        });
    }

    // Hook up BookOasis global library search input as well
    document.addEventListener('input', (e) => {
        const target = e.target;
        if (target && (target.id === 'library-search' || (target.matches && target.matches('[data-role="library-search-input"]')))) {
            performSearch(target.value);
        }
    }, true);

    // Theme Observer
    const themeObserver = new MutationObserver(() => {
        const activeTheme = document.documentElement.getAttribute('data-app-theme') || 'purple';
        console.log(`[YouTubePlaylistPlugin] App theme updated to: ${activeTheme}`);
    });
    themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['data-app-theme'] });

    // Initial Load
    loadData(true);
    attachSafeListeners();
    loadYouTubeIframeApi();
})();
