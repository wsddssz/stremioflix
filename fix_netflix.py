import io
p = 'src/components/NetflixPlayer.tsx'
t = io.open(p, encoding='utf-8').read()

# 1. After `const v = videoRef.current;` add resume key + load saved position
old1 = "    const v = videoRef.current;\n    if (!v || !url) {"
new1 = "    const v = videoRef.current;\n    if (!v || !url) {"
assert old1 in t, 'anchor 1 not found'
# We'll add resume key loading right after the url check return
old1b = "    if (!v || !url) { setError('No playable URL for this source.'); setLoading(false); return; }"
new1b = """    if (!v || !url) { setError('No playable URL for this source.'); setLoading(false); return; }
    const resumeK = resumeKey(meta.type, meta.id, video?.id ?? meta.id);
    const saved = getResume(resumeK);
    if (saved) setResumePos(saved.pos);"""
assert old1b in t, 'anchor 1b not found'
t = t.replace(old1b, new1b)

# 2. Modify onTime to save resume (throttled)
old_onTime = """    const onTime = () => {
      setTime(v.currentTime);
      setDur(v.duration || 0);
      const eng = engineRef.current;
      if (eng) setLiveCues(eng.cuesAt(v.currentTime - subStyleRef.current.delay));
      if (onNextEpisode && v.duration && v.duration - v.currentTime < 30 && v.duration > 60) setShowNext(true);
      else setShowNext(false);
    };"""
new_onTime = """    let lastResumeSave = 0;
    const onTime = () => {
      setTime(v.currentTime);
      setDur(v.duration || 0);
      const eng = engineRef.current;
      if (eng) setLiveCues(eng.cuesAt(v.currentTime - subStyleRef.current.delay));
      if (onNextEpisode && v.duration && v.duration - v.currentTime < 30 && v.duration > 60) setShowNext(true);
      else setShowNext(false);
      const now = Date.now();
      if (now - lastResumeSave > 2000) {
        lastResumeSave = now;
        saveResume(resumeK, v.currentTime, v.duration || 0);
      }
    };"""
assert old_onTime in t, 'onTime not found'
t = t.replace(old_onTime, new_onTime)

# 3. Modify onPause to save resume
old_onPause = "    const onPause = () => setPlaying(false);"
new_onPause = """    const onPause = () => {
      setPlaying(false);
      saveResume(resumeK, v.currentTime, v.duration || 0);
    };"""
assert old_onPause in t, 'onPause not found'
t = t.replace(old_onPause, new_onPause)

# 4. Modify onEnded to clear resume
old_onEnded = """    const onEnded = () => {
      if (closingRef.current) return;
      if (nextRef.current) setNextCount(5);
      else closeRef.current();
    };"""
new_onEnded = """    const onEnded = () => {
      if (closingRef.current) return;
      clearResume(resumeK);
      setResumePos(null);
      if (nextRef.current) setNextCount(5);
      else closeRef.current();
    };"""
assert old_onEnded in t, 'onEnded not found'
t = t.replace(old_onEnded, new_onEnded)

# 5. Add canplay event listener + cleanup
old_add = "    v.addEventListener('timeupdate', onTime);"
new_add = """    const onCanPlay = () => {
      const r = resumePos;
      if (r !== null) { v.currentTime = r; setResumePos(null); }
    };
    v.addEventListener('canplay', onCanPlay);
    v.addEventListener('timeupdate', onTime);"""
assert old_add in t, 'addEventListener timeupdate not found'
t = t.replace(old_add, new_add)

old_cleanup = "      v.removeEventListener('timeupdate', onTime);"
new_cleanup = """      v.removeEventListener('canplay', onCanPlay);
      v.removeEventListener('timeupdate', onTime);"""
assert old_cleanup in t, 'cleanup not found'
t = t.replace(old_cleanup, new_cleanup)

io.open(p, 'w', encoding='utf-8', newline='').write(t)
print('NetflixPlayer resume wiring done')
