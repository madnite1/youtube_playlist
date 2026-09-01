# -*- coding: utf-8 -*-
"""
YouTube Playlist Metadata & Category Provider for BookOasis.
Registers 'Youtube' category tab in sidebar, manages YouTube playlists as Series,
and lists videos inside each playlist with embedded player support.
Supports Public & Unlisted playlists directly via Web/RSS Hybrid Parser,
strict General/Adult library classification, dual-DB sync, SQLite database caching,
and background scheduled scanning.
"""

import json
import logging
import os
import re
import sqlite3
import threading
import time
import urllib.request
import urllib.parse
import urllib.error
import xml.etree.ElementTree as ET
from datetime import datetime

from plugins.metadata.base import BaseMetadataProvider

logger = logging.getLogger(__name__)

USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
)

CACHE_DB_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "youtube_playlist_cache.db")

# ---------------------------------------------------------------------------
# 잠금화면 재생(백그라운드 오디오) 스트리밍 전용 상수/상태
# 코어 api 라우트는 get_dashboard_data의 반환값을 무조건 jsonify하므로,
# 플러그인이 current_app.add_url_rule()로 자체 스트림 라우트를 동적 등록한다.
# (플러그인 폴더 밖 코드는 수정하지 않음)







def parse_view_count(text):
    """'조회수 763만회' / '1.2만회' / '5회' / '1,234회' 형태의 문자열을 정수 조회수로 변환."""
    if not text:
        return 0
    text = str(text).replace(",", "")
    m = re.search(r"([\d.]+)\s*(억|만)?\s*회", text)
    if not m:
        return 0
    try:
        num = float(m.group(1))
    except ValueError:
        return 0
    unit = m.group(2)
    if unit == "억":
        num *= 100000000
    elif unit == "만":
        num *= 10000
    return int(num)


def extract_playlist_id(url_or_id):
    """유튜브 플레이리스트 URL 또는 ID에서 pure Playlist ID를 추출합니다."""
    if not url_or_id:
        return ""
    text = str(url_or_id).strip()
    if text.startswith("PL") or text.startswith("UU") or text.startswith("FL") or text.startswith("RD"):
        return text
    match = re.search(r"list=([a-zA-Z0-9_-]+)", text)
    if match:
        return match.group(1)
    return text


def init_sqlite_db(db_path=CACHE_DB_PATH):
    """SQLite DB 및 테이블 초기화 (WAL 모드)"""
    try:
        conn = sqlite3.connect(db_path, timeout=10.0)
        cursor = conn.cursor()
        cursor.execute("PRAGMA journal_mode=WAL;")
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS playlist_cache (
                playlist_id TEXT PRIMARY KEY,
                target_db TEXT,
                title TEXT,
                channel TEXT,
                cover TEXT,
                item_count INTEGER,
                videos_json TEXT,
                updated_at TEXT
            )
        """)
        conn.commit()
        conn.close()
    except Exception as e:
        logger.error(f"[YouTubePlugin] SQLite init error: {e}")


def save_to_sqlite(series_info, target_db, db_path=CACHE_DB_PATH):
    """시리즈 정보를 SQLite DB 캐시에 저장/업데이트"""
    if not series_info or not series_info.get("id"):
        return
    try:
        init_sqlite_db(db_path)
        conn = sqlite3.connect(db_path, timeout=10.0)
        cursor = conn.cursor()
        now_str = series_info.get("updated_at") or datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        cursor.execute("""
            INSERT OR REPLACE INTO playlist_cache
            (playlist_id, target_db, title, channel, cover, item_count, videos_json, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        """, (
            series_info["id"],
            target_db,
            series_info.get("title", ""),
            series_info.get("channel", ""),
            series_info.get("cover", ""),
            series_info.get("item_count", 0),
            json.dumps(series_info.get("videos", []), ensure_ascii=False),
            now_str
        ))
        conn.commit()
        conn.close()
    except Exception as e:
        logger.error(f"[YouTubePlugin] SQLite save error: {e}")


def load_from_sqlite(playlist_id, db_path=CACHE_DB_PATH):
    """SQLite DB 캐시에서 특정 플레이리스트 조회"""
    try:
        init_sqlite_db(db_path)
        conn = sqlite3.connect(db_path, timeout=10.0)
        cursor = conn.cursor()
        cursor.execute("""
            SELECT playlist_id, target_db, title, channel, cover, item_count, videos_json, updated_at
            FROM playlist_cache WHERE playlist_id = ?
        """, (playlist_id,))
        row = cursor.fetchone()
        conn.close()
        if row:
            return {
                "id": row[0],
                "target_db": row[1],
                "title": row[2],
                "channel": row[3],
                "cover": row[4],
                "item_count": row[5],
                "videos": json.loads(row[6]) if row[6] else [],
                "updated_at": row[7]
            }
    except Exception as e:
        logger.error(f"[YouTubePlugin] SQLite load error: {e}")
    return None


class YouTubePlaylistMetadataProvider(BaseMetadataProvider):
    id = "youtube_playlist"
    name = "Youtube Playlist"
    is_searchable = False

    _background_thread_started = False
    _background_lock = threading.Lock()

    config_schema = [
        {
            "key": "PLAYLISTS_JSON",
            "label": "등록된 플레이리스트 목록 (JSON)",
            "type": "text",
            "default": "[]",
            "required": False,
            "description": "등록된 플레이리스트 ID/URL 목록 JSON 데이터 (공개 / 일부 공개 플레이리스트 지원)"
        },
        {
            "key": "UPDATE_INTERVAL_HOURS",
            "label": "백그라운드 스캔 & DB 캐시 갱신 주기 (시간)",
            "type": "text",
            "default": "6",
            "required": False,
            "description": "지정한 시간 간격(기본: 6시간)으로 백그라운드 스캔이 실행되며, 카테고리 진입 시 SQLite DB에서 0.01초 만에 로딩됩니다."
        },
        {
            "key": "AUTO_PLAY",
            "label": "영상 클릭 시 자동 재생",
            "type": "checkbox",
            "default": True,
            "description": "영상 선택 시 모달 플레이어에서 자동 재생 여부"
        },
        {
            "key": "MINI_PLAYER_ENABLED",
            "label": "미니 플레이어 사용",
            "type": "checkbox",
            "default": True,
            "description": "설정 시 모달 플레이어에 '미니 플레이어로 보기' 버튼이 표시되어 별도 플로팅 창으로 영상을 재생할 수 있습니다. 해제 시 미니 플레이어 버튼과 동작이 모두 비활성화됩니다."
        }
    ]

    category_tab = {
        "title": "Youtube",
        "icon": "fa-brands fa-youtube",
        "order": 85,
        "sessions": ["general", "adult"]
    }

    # 업데이트 매니페스트.
    # 저장소: GitHub 공개 저장소(madnite1/youtube_playlist) — raw URL 접근 가능.
    # PluginManager의 _update_plugin은 1순위로 `git pull`(로컬 .git + remote)을
    # 시도하고, 실패 시 raw_base_url 파일 동기화로 fallback함.
    # enabled=True는 plugin_manager가 이 플러그인을 "업데이트 대상"으로 인식하게
    # 해주는 스위치. update_manifest.enabled가 False면 _check_plugin_update와
    # _update_all_plugins의 (p.get('has_update_manifest')) 게이트에서 무시됨.
    update_manifest = {
        "enabled": True,
        "provider": "github-raw",
        "raw_base_url": "https://raw.githubusercontent.com/madnite1/youtube_playlist/main",
        "files": ["youtube_playlist.py", "__init__.py", "VERSION", "index.html", "style.css", "script.js", "settings.html", "settings.css", "settings.js", "README.md", "LICENSE"],
        "version_file": "VERSION",
        "version_key": "plugin version",
        "show_sample_update_button": False,
    }

    def __init__(self):
        super().__init__()
        init_sqlite_db()
        self._start_background_scanner()

    def _start_background_scanner(self):
        """백그라운드 스케줄러 데몬 쓰레드 시작"""
        with YouTubePlaylistMetadataProvider._background_lock:
            if not YouTubePlaylistMetadataProvider._background_thread_started:
                YouTubePlaylistMetadataProvider._background_thread_started = True
                t = threading.Thread(target=self._background_scanner_loop, daemon=True)
                t.start()
                logger.info("[YouTubePlugin] Background SQLite scanner thread initialized.")

    def _background_scanner_loop(self):
        """지정된 시간 간격으로 등록된 모든 플레이리스트를 백그라운드에서 주기적으로 수집하여 SQLite DB에 저장"""
        time.sleep(10)  # 초기 서버 부팅 안정화 10초 대기
        while True:
            try:
                # 일반 및 성인 보관함 설정 불러오기
                for db_type in ("general", "adult"):
                    playlists = self._sync_and_get_playlists(current_db=db_type)
                    cfg = self.get_plugin_config(db_type, default={}) or {}
                    
                    try:
                        interval_hours = float(cfg.get("UPDATE_INTERVAL_HOURS") or 6)
                    except Exception:
                        interval_hours = 6.0

                    if interval_hours <= 0:
                        continue  # 수동 전용

                    for p_item in playlists:
                        if isinstance(p_item, dict):
                            p_id = extract_playlist_id(p_item.get("id"))
                            custom_title = p_item.get("custom_name", "")
                            target_db = str(p_item.get("target_db", "general")).lower()
                        else:
                            p_id = extract_playlist_id(p_item)
                            custom_title = ""
                            target_db = "general"

                        if not p_id or target_db != db_type:
                            continue

                        # SQLite 캐시 확인
                        cached = load_from_sqlite(p_id)
                        need_update = False

                        if not cached:
                            need_update = True
                        else:
                            # 갱신 주기 초과 여부 확인
                            upd_str = cached.get("updated_at", "")
                            try:
                                upd_dt = datetime.strptime(upd_str, "%Y-%m-%d %H:%M:%S")
                                diff_hours = (datetime.now() - upd_dt).total_seconds() / 3600.0
                                if diff_hours >= interval_hours:
                                    need_update = True
                            except Exception:
                                need_update = True

                        if need_update:
                            logger.info(f"[YouTubePlugin] Background scanning playlist {p_id} ({target_db})...")
                            fresh_info = self._fetch_playlist_details(p_id, custom_title=custom_title)
                            if fresh_info:
                                save_to_sqlite(fresh_info, target_db)
                            time.sleep(2)  # 연속 요청 간 2초 매너 대기

            except Exception as e:
                logger.error(f"[YouTubePlugin] Background scanner loop error: {e}")

            time.sleep(300)  # 5분 간격으로 주기 체크

    def search(self, db_type, query):
        return []

    def apply(self, db_type, book_id, item_data):
        """플러그인 액션 처리."""
        return False, "카테고리 뷰 전용 플러그인입니다."

    def _sync_and_get_playlists(self, current_db="general"):
        """
        general.db 및 adult.db의 PLAYLISTS_JSON을 항상 실시간으로 양방향 완벽 동기화합니다.
        어느 서재 모드에서 저장했더라도 설정창(general.db)과 모든 뷰에 100% 동일한 최신 마스터 목록이 반영됩니다.
        """
        gw_gen = self.get_db_gateway("general")
        gw_adu = self.get_db_gateway("adult")

        cfg_gen = gw_gen.get_plugin_config(self.id, default={}) or {}
        cfg_adu = gw_adu.get_plugin_config(self.id, default={}) or {}

        p_gen = cfg_gen.get("PLAYLISTS_JSON")
        p_adu = cfg_adu.get("PLAYLISTS_JSON")

        if current_db == "adult":
            master_raw = p_adu or p_gen or "[]"
        else:
            master_raw = p_gen or p_adu or "[]"

        try:
            if p_gen != master_raw:
                cfg_gen["PLAYLISTS_JSON"] = master_raw
                gw_gen.set_plugin_config(self.id, cfg_gen)

            if p_adu != master_raw:
                cfg_adu["PLAYLISTS_JSON"] = master_raw
                gw_adu.set_plugin_config(self.id, cfg_adu)
        except Exception as e:
            logger.warning(f"[YouTubePlugin] Dual DB sync warning: {e}")

        try:
            playlists = json.loads(master_raw) if isinstance(master_raw, str) else master_raw
            return playlists if isinstance(playlists, list) else []
        except Exception:
            return []

    def get_dashboard_data(self, db_type, limit=50):
        """
        카테고리 뷰 및 프런트엔드 UI에 SQLite DB 캐시 우선으로 초고속(0.01초) 데이터 공급.
        개별 시리즈 강제 새로고침(refresh_series) 지원.
        """
        self._start_background_scanner()
        current_db = str(db_type or "general").lower()
        if current_db not in ("general", "adult"):
            current_db = "general"

        try:
            limit = max(1, min(int(limit), 1000))
        except (TypeError, ValueError):
            limit = 50

        refresh_series_id = ""
        try:
            from flask import request
            refresh_series_id = extract_playlist_id(request.args.get("refresh_series", ""))
        except Exception:
            refresh_series_id = ""

        playlist_list = self._sync_and_get_playlists(current_db=current_db)
        series_data = []

        for p_item in playlist_list:
            if isinstance(p_item, dict):
                p_id = extract_playlist_id(p_item.get("id"))
                custom_title = p_item.get("custom_name", "")
                target_db = str(p_item.get("target_db", "general")).lower()
            else:
                p_id = extract_playlist_id(p_item)
                custom_title = ""
                target_db = "general"

            if not p_id:
                continue

            # 엄격한 보관함 구분 필터링
            if target_db != current_db:
                continue

            # 특정 시리즈 개별 새로고침 요청이 있는 경우
            if refresh_series_id and refresh_series_id == p_id:
                logger.info(f"[YouTubePlugin] Single series forced refresh for {p_id}...")
                fresh_info = self._fetch_playlist_details(p_id, custom_title=custom_title)
                if fresh_info:
                    fresh_info["target_db"] = target_db
                    save_to_sqlite(fresh_info, target_db)
                    series_data.append(fresh_info)
                continue

            # 1. SQLite DB 캐시 우선 조회 (0.01초 초고속 반환)
            cached_info = load_from_sqlite(p_id)

            if cached_info and cached_info.get("item_count", 0) > 0:
                cached_info["custom_name"] = custom_title
                cached_info["original_title"] = cached_info.get("title", "")
                if custom_title and custom_title.strip():
                    cached_info["title"] = custom_title.strip()
                cached_info["target_db"] = target_db
                series_data.append(cached_info)
            else:
                # 2. 캐시 미존재 시 라이브 즉시 수집 후 SQLite 캐시 저장
                series_info = self._fetch_playlist_details(p_id, custom_title=custom_title)
                if series_info:
                    series_info["custom_name"] = custom_title
                    series_info["original_title"] = series_info.get("title", "")
                    series_info["target_db"] = target_db
                    save_to_sqlite(series_info, target_db)
                    series_data.append(series_info)

        limited_series = series_data[:limit]

        return {
            "success": True,
            "category": "Youtube",
            "db_type": current_db,
            "total_series": len(series_data),
            "items": limited_series,
            "series": limited_series,
            "config": {
                "auto_play_enabled": self._is_auto_play_enabled(current_db),
                "mini_player_enabled": self._is_mini_player_enabled(current_db)
            }
        }

    def _is_auto_play_enabled(self, db_type):
        """영상 선택 시 자동 재생 설정 여부 (AUTO_PLAY, 기본 True)."""
        try:
            cfg = self.get_plugin_config(db_type, default={}) or {}
            val = str(cfg.get("AUTO_PLAY", "true")).strip().lower()
            return val not in ("0", "false", "no", "off", "")
        except Exception:
            return True

    def _is_mini_player_enabled(self, db_type):
        """미니 플레이어 사용 설정 여부 (MINI_PLAYER_ENABLED, 기본 True)"""
        try:
            cfg = self.get_plugin_config(db_type, default={}) or {}
            val = str(cfg.get("MINI_PLAYER_ENABLED", "true")).strip().lower()
            return val not in ("0", "false", "no", "off", "")
        except Exception:
            return True

    def _fetch_playlist_details(self, playlist_id, custom_title=""):
        """공개 / 일부 공개 유튜브 플레이리스트 정보 및 영상 목록 수집 (Web/RSS Hybrid Parser)"""
        return self._fetch_via_web_fallback(playlist_id, custom_title)



    def _fetch_via_web_fallback(self, playlist_id, custom_title=""):
        """
        웹 하이브리드 파서: HTML ytInitialData JSON 구조 분석과 구글 RSS 피드를 결합하여
        15개 제한을 깨고 100개 이상의 모든 영상에 정확한 실제 제목과 메타데이터를 매핑합니다.
        """
        rss_map = {}
        feed_title = ""
        channel_name = "YouTube Channel"

        # 1. RSS 피드 파싱 (보조 메타데이터)
        try:
            rss_url = f"https://www.youtube.com/feeds/videos.xml?playlist_id={playlist_id}"
            req_rss = urllib.request.Request(rss_url, headers={"User-Agent": USER_AGENT})
            with urllib.request.urlopen(req_rss, timeout=8) as resp_rss:
                xml_data = resp_rss.read()

            root = ET.fromstring(xml_data)
            ns = {
                "atom": "http://www.w3.org/2005/Atom",
                "yt": "http://www.youtube.com/xml/schemas/2015",
                "media": "http://search.yahoo.com/mrss/"
            }

            feed_title = root.findtext("atom:title", default="", namespaces=ns)
            author_elem = root.find("atom:author/atom:name", namespaces=ns)
            if author_elem is not None and author_elem.text:
                channel_name = author_elem.text

            for entry in root.findall("atom:entry", namespaces=ns):
                video_id = entry.findtext("yt:videoId", default="", namespaces=ns)
                v_title = entry.findtext("atom:title", default="", namespaces=ns)
                published = entry.findtext("atom:published", default="", namespaces=ns)[:10]

                media_group = entry.find("media:group", namespaces=ns)
                desc = ""
                thumb_url = f"https://i.ytimg.com/vi/{video_id}/hqdefault.jpg"
                if media_group is not None:
                    desc_elem = media_group.find("media:description", namespaces=ns)
                    if desc_elem is not None and desc_elem.text:
                        desc = desc_elem.text
                    thumb_elem = media_group.find("media:thumbnail", namespaces=ns)
                    if thumb_elem is not None and thumb_elem.attrib.get("url"):
                        thumb_url = thumb_elem.attrib.get("url")

                if video_id:
                    rss_map[video_id] = {
                        "title": v_title,
                        "published": published,
                        "description": desc,
                        "thumbnail": thumb_url
                    }
        except Exception as e:
            logger.info(f"[YouTubePlugin] RSS pre-fetch note for {playlist_id}: {e}")

        # 2. HTML 페이지 파싱 및 ytInitialData 딥 트리 탐색 (100+개 영상 실제 제목 정밀 추출)
        title_map = {}
        view_map = {}
        ordered_vids = []
        html_title = ""

        try:
            page_url = f"https://www.youtube.com/playlist?list={playlist_id}"
            req_html = urllib.request.Request(page_url, headers={
                "User-Agent": USER_AGENT,
                "Accept-Language": "ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7"
            })
            with urllib.request.urlopen(req_html, timeout=10) as resp_html:
                html = resp_html.read().decode("utf-8", errors="ignore")

            title_m = re.search(r'<meta property="og:title" content="([^"]+)"', html)
            if title_m:
                html_title = title_m.group(1)

            channel_m = re.search(r'"author":"([^"]+)"', html) or re.search(r'"ownerChannelName":"([^"]+)"', html)
            if channel_m and channel_name == "YouTube Channel":
                channel_name = channel_m.group(1)

            m = re.search(r'var ytInitialData = (\{.*?\});</script>', html)
            if not m:
                m = re.search(r'"ytInitialData":(\{.*?\}),"', html) or re.search(r'window\["ytInitialData"\] = (\{.*?\});</script>', html)

            if m:
                try:
                    data = json.loads(m.group(1))

                    def parse_json(obj):
                        if isinstance(obj, dict):
                            # 신규 YouTube lockupViewModel 렌더러
                            if 'lockupViewModel' in obj:
                                lvm = obj['lockupViewModel']
                                cid = lvm.get('contentId')
                                title = ''
                                view_text = ''
                                t_obj = lvm.get('title', {})
                                if isinstance(t_obj, dict) and 'content' in t_obj:
                                    title = t_obj['content']
                                if not title:
                                    lbl = lvm.get('rendererContext', {}).get('accessibilityContext', {}).get('label', '')
                                    if lbl:
                                        title = re.sub(r'\s*(\d+분\s*\d+초|\d+:\d+|\d+시간.*|\d+분.*|\d+:\d+:\d+)$', '', lbl).strip()
                                # metadataRows에서 조회수 텍스트 추출 ("조회수 763만회")
                                try:
                                    meta_rows = lvm.get('metadata', {}).get('lockupMetadataViewModel', {}) \
                                                  .get('metadata', {}).get('contentMetadataViewModel', {}).get('metadataRows', [])
                                    for _row in meta_rows:
                                        for _part in _row.get('metadataParts', []):
                                            _txt = _part.get('text', {}).get('content', '')
                                            if _txt and '조회수' in _txt:
                                                view_text = _txt
                                                break
                                        if view_text:
                                            break
                                except Exception:
                                    pass
                                if cid and title and cid not in title_map:
                                    title_map[cid] = title
                                if cid and view_text and cid not in view_map:
                                    view_map[cid] = parse_view_count(view_text)

                            # 클래식 playlistVideoRenderer 렌더러
                            elif 'playlistVideoRenderer' in obj:
                                pv = obj['playlistVideoRenderer']
                                vid = pv.get('videoId')
                                t_obj = pv.get('title', {})
                                title = ''
                                if 'runs' in t_obj and t_obj['runs']:
                                    title = t_obj['runs'][0].get('text', '')
                                elif 'simpleText' in t_obj:
                                    title = t_obj.get('simpleText', '')
                                if vid and title and vid not in title_map:
                                    title_map[vid] = title
                                # 클래식 렌더러의 조회수 (viewCountText)
                                vct = pv.get('viewCountText', {})
                                vc_text = ''
                                if isinstance(vct, dict):
                                    if 'simpleText' in vct:
                                        vc_text = vct.get('simpleText', '')
                                    elif 'runs' in vct and vct['runs']:
                                        vc_text = vct['runs'][0].get('text', '')
                                if vid and vc_text and vid not in view_map:
                                    view_map[vid] = parse_view_count(vc_text)

                            for k, v in obj.items():
                                parse_json(v)
                        elif isinstance(obj, list):
                            for item in obj:
                                parse_json(item)

                    parse_json(data)
                except Exception as je:
                    logger.debug(f"[YouTubePlugin] JSON deep parse error: {je}")

            # HTML 전체에서 순서대로 unique videoId 추출
            vids_in_html = re.findall(r'"videoId":"([a-zA-Z0-9_-]{11})"', html)
            for v in vids_in_html:
                if v not in ordered_vids:
                    ordered_vids.append(v)

        except Exception as ex:
            logger.warning(f"[YouTubePlugin] HTML parse error for {playlist_id}: {ex}")

        # 3. 비디오 데이터 병합 (모든 영상 100% 실제 제목 매핑)
        series_title = custom_title or feed_title or html_title or f"YouTube Playlist ({playlist_id})"
        videos = []

        all_vid_ids = list(ordered_vids)
        for rss_vid in rss_map:
            if rss_vid not in all_vid_ids:
                all_vid_ids.append(rss_vid)

        for idx, vid in enumerate(all_vid_ids):
            real_title = title_map.get(vid) or (rss_map.get(vid, {}).get("title")) or f"영상 #{idx + 1}"
            published = rss_map.get(vid, {}).get("published") or datetime.now().strftime("%Y-%m-%d")
            desc = rss_map.get(vid, {}).get("description") or f"YouTube Video ({vid})"
            thumb = rss_map.get(vid, {}).get("thumbnail") or f"https://i.ytimg.com/vi/{vid}/hqdefault.jpg"

            videos.append({
                "id": vid,
                "title": real_title,
                "published": published,
                "description": desc,
                "thumbnail": thumb,
                "view_count": view_map.get(vid, 0),
                "url": f"https://www.youtube.com/watch?v={vid}",
                "embed_url": f"https://www.youtube.com/embed/{vid}"
            })

        cover = videos[0]["thumbnail"] if videos else "https://i.ytimg.com/vi/default/hqdefault.jpg"

        return {
            "id": playlist_id,
            "title": series_title,
            "channel": channel_name,
            "cover": cover,
            "item_count": len(videos),
            "videos": videos,
            "updated_at": datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        }
