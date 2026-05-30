/**
 * @test install-skill
 * @intent Verify installSkill() handles deps check, registry lookup, download, config, and errors
 */
const fs = require('fs');
const path = require('path');
const os = require('os');
const https = require('https');
const { EventEmitter } = require('events');

function mockHttpsGet(optsOrList) {
  const list = Array.isArray(optsOrList) ? [...optsOrList] : [optsOrList];
  // Synchronous fake createWriteStream — the real one opens the FD asynchronously
  // and races against downloadFile's unlinkSync(dest) in 301/302/error branches,
  // causing ENOENT unhandled errors.
  vi.spyOn(fs, 'createWriteStream').mockImplementation((dest) => {
    let buf = '';
    try {
      fs.writeFileSync(dest, '');
    } catch {
      /* dest dir may not exist; downstream code will surface that */
    }
    const stream = new EventEmitter();
    stream.write = (chunk) => {
      buf += chunk;
      return true;
    };
    stream.end = () => {
      try {
        fs.writeFileSync(dest, buf);
      } catch {
        /* file may have been unlinked by source; safe to ignore */
      }
      process.nextTick(() => stream.emit('finish'));
    };
    stream.close = () => {};
    return stream;
  });

  vi.spyOn(https, 'get').mockImplementation((url, options, cb) => {
    const callback = typeof options === 'function' ? options : cb;
    const req = new EventEmitter();
    const config = list.shift() || { statusCode: 200, body: '# Skill' };
    process.nextTick(() => {
      if (config.errorAfter) {
        req.emit('error', new Error('Network error'));
        return;
      }
      const response = new EventEmitter();
      response.statusCode = config.statusCode != null ? config.statusCode : 200;
      response.headers = config.redirectTo ? { location: config.redirectTo } : {};
      response.pipe = (file) => {
        file.write(config.body != null ? config.body : '# Skill');
        file.end();
      };
      callback(response);
    });
    return req;
  });
}

describe('install-skill', () => {
  let tmpHome, originalHome;

  beforeEach(() => {
    originalHome = process.env.HOME;
    tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'xpgate-in-'));
    process.env.HOME = tmpHome;
    vi.resetModules();
    delete require.cache[require.resolve('../install-skill')];
    delete require.cache[require.resolve('../detect-deps')];
    delete require.cache[require.resolve('../download-skill')];
    delete require.cache[require.resolve('../rollback')];
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(async () => {
    await new Promise((resolve) => setImmediate(resolve));
    process.env.HOME = originalHome;
    vi.restoreAllMocks();
    if (fs.existsSync(tmpHome)) {
      fs.rmSync(tmpHome, { recursive: true, force: true });
    }
  });

  function skillsDir() {
    return path.join(tmpHome, '.config', 'opencode', 'skills');
  }

  function configDir() {
    return path.join(tmpHome, '.config', 'xp-gate');
  }

  function setupValidDeps() {
    ['superpowers', 'gstack'].forEach((name) => {
      const dir = path.join(skillsDir(), name);
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(
        path.join(dir, 'package.json'),
        JSON.stringify({ version: '2.0.0' })
      );
    });
  }

  it('returns 1 + error when superpowers dep is missing', async () => {
    const { installSkill } = require('../install-skill');
    const result = await installSkill('sprint-flow');
    expect(result).toBe(1);
    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining('superpowers is required')
    );
  });

  it('returns 1 + error when gstack dep is missing (superpowers present)', async () => {
    const dir = path.join(skillsDir(), 'superpowers');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ version: '2.0.0' }));

    const { installSkill } = require('../install-skill');
    const result = await installSkill('sprint-flow');
    expect(result).toBe(1);
    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining('gstack is required')
    );
  });

  it('returns 1 + error when dep version is too old (versionMismatch branch)', async () => {
    ['superpowers', 'gstack'].forEach((name) => {
      const dir = path.join(skillsDir(), name);
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(
        path.join(dir, 'package.json'),
        JSON.stringify({ version: '0.5.0' })
      );
    });

    const { installSkill } = require('../install-skill');
    const result = await installSkill('sprint-flow');
    expect(result).toBe(1);
    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining('version too old')
    );
  });

  it('returns 1 + Unknown skill error for unregistered name', async () => {
    setupValidDeps();
    const { installSkill } = require('../install-skill');
    const result = await installSkill('not-a-real-skill');
    expect(result).toBe(1);
    expect(console.error).toHaveBeenCalledWith('Error: Unknown skill: not-a-real-skill');
  });

  it('returns 0 and writes SKILL.md when install succeeds', async () => {
    setupValidDeps();
    mockHttpsGet({ statusCode: 200, body: '# Sprint Flow\nskill content' });

    const { installSkill } = require('../install-skill');
    const result = await installSkill('sprint-flow', { remote: true });

    expect(result).toBe(0);
    const installedFile = path.join(skillsDir(), 'sprint-flow', 'SKILL.md');
    expect(fs.existsSync(installedFile)).toBe(true);
    expect(fs.readFileSync(installedFile, 'utf8')).toContain('Sprint Flow');
    expect(console.log).toHaveBeenCalledWith('✓ sprint-flow installed');
  });

  it('updates config with installedSkills metadata after successful install', async () => {
    setupValidDeps();
    mockHttpsGet({ statusCode: 200, body: '# Content' });

    const { installSkill } = require('../install-skill');
    await installSkill('delphi-review', { remote: true });

    const configFile = path.join(configDir(), 'xp-gate.json');
    expect(fs.existsSync(configFile)).toBe(true);
    const config = JSON.parse(fs.readFileSync(configFile, 'utf8'));
    expect(config.installedSkills).toHaveProperty('delphi-review');
    expect(config.installedSkills['delphi-review'].version).toBe('1.0.0');
    expect(config.installedSkills['delphi-review'].installedAt).toMatch(/^\d{4}-/);
  });

  it('returns 1 + already-installed error when target exists and force=false', async () => {
    setupValidDeps();
    const target = path.join(skillsDir(), 'sprint-flow');
    fs.mkdirSync(target, { recursive: true });
    fs.writeFileSync(path.join(target, 'SKILL.md'), 'existing');

    const { installSkill } = require('../install-skill');
    const result = await installSkill('sprint-flow');

    expect(result).toBe(1);
    expect(console.error).toHaveBeenCalledWith('Error: sprint-flow is already installed');
  });

  it('backs up and replaces when target exists and force=true', async () => {
    setupValidDeps();
    const target = path.join(skillsDir(), 'sprint-flow');
    fs.mkdirSync(target, { recursive: true });
    fs.writeFileSync(path.join(target, 'OLD.md'), 'old-content');
    mockHttpsGet({ statusCode: 200, body: '# New Content' });

    const { installSkill } = require('../install-skill');
    const result = await installSkill('sprint-flow', { force: true, remote: true });

    expect(result).toBe(0);
    const skillMd = path.join(target, 'SKILL.md');
    expect(fs.existsSync(skillMd)).toBe(true);
    expect(fs.readFileSync(skillMd, 'utf8')).toContain('New Content');

    const backupRoot = path.join(configDir(), 'backup');
    expect(fs.existsSync(backupRoot)).toBe(true);
    const backups = fs.readdirSync(backupRoot);
    expect(backups.length).toBeGreaterThan(0);
    const backedUpFile = path.join(backupRoot, backups[0], 'OLD.md');
    expect(fs.existsSync(backedUpFile)).toBe(true);
    expect(fs.readFileSync(backedUpFile, 'utf8')).toBe('old-content');
  });

  it('returns 1 + Failed to download when network fails (non-offline)', async () => {
    setupValidDeps();
    mockHttpsGet({ statusCode: 404 });

    const { installSkill } = require('../install-skill');
    const result = await installSkill('sprint-flow', { remote: true });

    expect(result).toBe(1);
    expect(console.error).toHaveBeenCalledWith('Error: Failed to download sprint-flow');
  });

  it('returns 2 + offline-cache error when offline=true and no cache', async () => {
    setupValidDeps();

    const { installSkill } = require('../install-skill');
    const result = await installSkill('sprint-flow', { offline: true, remote: true });

    expect(result).toBe(2);
    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining('--offline specified but sprint-flow not in cache')
    );
  });

  it('verbose=true prints Downloading and Installed-to logs', async () => {
    setupValidDeps();
    mockHttpsGet({ statusCode: 200, body: '# X' });

    const { installSkill } = require('../install-skill');
    await installSkill('test-specification-alignment', { verbose: true, remote: true });

    expect(console.log).toHaveBeenCalledWith(expect.stringContaining('Downloading '));
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining('Installed to '));
  });

  it('verbose=true prints download-failure warning when network errors', async () => {
    setupValidDeps();
    mockHttpsGet({ statusCode: 500 });

    const { installSkill } = require('../install-skill');
    const result = await installSkill('ralph-loop', { verbose: true, remote: true });

    expect(result).toBe(1);
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('Download failed'));
  });

  it('follows redirect (302) to download successfully', async () => {
    setupValidDeps();
    mockHttpsGet([
      { statusCode: 302, redirectTo: 'https://new.example.com/skill.md' },
      { statusCode: 200, body: '# Redirected Content' },
    ]);

    const { installSkill } = require('../install-skill');
    const result = await installSkill('sprint-flow', { remote: true });

    expect(result).toBe(0);
    const installedFile = path.join(skillsDir(), 'sprint-flow', 'SKILL.md');
    expect(fs.readFileSync(installedFile, 'utf8')).toContain('Redirected Content');
  });

  it('merges new skill into existing installedSkills config', async () => {
    setupValidDeps();
    fs.mkdirSync(configDir(), { recursive: true });
    fs.writeFileSync(
      path.join(configDir(), 'xp-gate.json'),
      JSON.stringify({
        installedSkills: { 'other-skill': { version: '0.1.0' } },
        otherSetting: true,
      })
    );
    mockHttpsGet({ statusCode: 200, body: '# X' });

    const { installSkill } = require('../install-skill');
    await installSkill('delphi-review', { remote: true });

    const config = JSON.parse(
      fs.readFileSync(path.join(configDir(), 'xp-gate.json'), 'utf8')
    );
    expect(config.installedSkills).toHaveProperty('other-skill');
    expect(config.installedSkills).toHaveProperty('delphi-review');
    expect(config.otherSetting).toBe(true);
  });

  it('handles malformed config JSON during update (catch returns {})', async () => {
    setupValidDeps();
    fs.mkdirSync(configDir(), { recursive: true });
    fs.writeFileSync(path.join(configDir(), 'xp-gate.json'), '{not-valid-json');
    mockHttpsGet({ statusCode: 200, body: '# X' });

    const { installSkill } = require('../install-skill');
    const result = await installSkill('sprint-flow', { remote: true });
    expect(result).toBe(0);
  });

  it('returns 1 + Failed to download on network error (non-verbose silent)', async () => {
    setupValidDeps();
    mockHttpsGet({ errorAfter: true });

    const { installSkill } = require('../install-skill');
    const result = await installSkill('test-specification-alignment', { remote: true });

    expect(result).toBe(1);
    expect(console.warn).not.toHaveBeenCalled();
    expect(console.error).toHaveBeenCalledWith('Error: Failed to download test-specification-alignment');
  });

  // AC-02c: SKILLS_REGISTRY keys match actual skill directory names
  describe('SKILLS_REGISTRY consistency (AC-02c)', () => {
    const { SKILLS_REGISTRY } = require('../install-skill');
    const localSkillsRoot = path.join(__dirname, '..', '..', 'skills');

    Object.keys(SKILLS_REGISTRY).forEach((key) => {
      it(`registry key '${key}' matches a local directory in skills/`, () => {
        const localPath = path.join(localSkillsRoot, key);
        expect(fs.existsSync(localPath)).toBe(true);
      });
    });

    it('does not contain legacy key "test-spec"', () => {
      expect(SKILLS_REGISTRY).not.toHaveProperty('test-spec');
    });

    it('contains "test-specification-alignment"', () => {
      expect(SKILLS_REGISTRY).toHaveProperty('test-specification-alignment');
    });
  });

  // AC-03b: installSkill defaults to package-local first
  describe('local-first install (AC-03b)', () => {
    it('copies from local package without HTTP when skill exists locally', async () => {
      setupValidDeps();
      const httpsSpy = vi.spyOn(https, 'get');

      const { installSkill } = require('../install-skill');
      const result = await installSkill('delphi-review');

      expect(result).toBe(0);
      expect(httpsSpy).not.toHaveBeenCalled();
      const skillMd = path.join(skillsDir(), 'delphi-review', 'SKILL.md');
      expect(fs.existsSync(skillMd)).toBe(true);
    });

    it('recursively copies entire directory (not just SKILL.md)', async () => {
      setupValidDeps();
      const { installSkill } = require('../install-skill');
      const result = await installSkill('delphi-review');

      expect(result).toBe(0);
      const installedDir = path.join(skillsDir(), 'delphi-review');
      const sourceDir = path.join(__dirname, '..', '..', 'skills', 'delphi-review');
      const sourceEntries = fs.readdirSync(sourceDir);
      for (const entry of sourceEntries) {
        expect(fs.existsSync(path.join(installedDir, entry))).toBe(true);
      }
    });

    it('falls back to remote when --remote flag is set even if local exists', async () => {
      setupValidDeps();
      mockHttpsGet({ statusCode: 200, body: '# Remote-fetched' });

      const { installSkill } = require('../install-skill');
      const result = await installSkill('delphi-review', { remote: true });

      expect(result).toBe(0);
      expect(https.get).toHaveBeenCalled();
      const skillMd = path.join(skillsDir(), 'delphi-review', 'SKILL.md');
      expect(fs.readFileSync(skillMd, 'utf8')).toContain('Remote-fetched');
    });
  });

  // AC-07: Error message format on failure
  describe('AC-07 error message format', () => {
    it('error message contains reason, packaged skill list, and manual install command', async () => {
      setupValidDeps();
      mockHttpsGet({ statusCode: 404 });

      const { installSkill } = require('../install-skill');
      const result = await installSkill('sprint-flow', { remote: true });

      expect(result).toBe(1);

      const errorCalls = console.error.mock.calls.map((args) => args.join(' '));
      const combined = errorCalls.join('\n');

      expect(combined).toContain("Failed to install skill 'sprint-flow'");
      expect(combined).toContain('Reason:');
      expect(combined).toContain('Packaged skills (available offline):');
      expect(combined).toContain('xp-gate install-skill sprint-flow --remote');
    });
  });

  // AC-11: Atomic install - failure leaves no orphaned files (rollback)
  describe('AC-11 atomic install', () => {
    it('restores prior content on remote-download failure when force=true', async () => {
      setupValidDeps();
      const target = path.join(skillsDir(), 'sprint-flow');
      fs.mkdirSync(target, { recursive: true });
      fs.writeFileSync(path.join(target, 'EXISTING.md'), 'original');
      mockHttpsGet({ statusCode: 500 });

      const { installSkill } = require('../install-skill');
      const result = await installSkill('sprint-flow', { force: true, remote: true });

      expect(result).toBe(1);
      const backupRoot = path.join(configDir(), 'backup');
      expect(fs.existsSync(backupRoot)).toBe(true);
      const skillMdAfter = path.join(target, 'SKILL.md');
      expect(fs.existsSync(skillMdAfter)).toBe(false);
    });

    it('leaves no orphaned SKILL.md when remote install fails and target did not pre-exist', async () => {
      setupValidDeps();
      mockHttpsGet({ statusCode: 500 });

      const { installSkill } = require('../install-skill');
      const result = await installSkill('sprint-flow', { remote: true });

      expect(result).toBe(1);
      const target = path.join(skillsDir(), 'sprint-flow');
      const skillMd = path.join(target, 'SKILL.md');
      expect(fs.existsSync(skillMd)).toBe(false);
    });
  });
});
