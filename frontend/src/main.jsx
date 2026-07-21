import React, { useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import * as pdfjsLib from 'pdfjs-dist';
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import {
  API_BASE,
  connectEmailInbox,
  compileExperience,
  getBuild,
  getHealth,
  launchExperience,
  listArtifacts,
  listBuilds,
  listTemplates,
  normalizeIrx,
  runPreprocessing,
  transcribeAudio,
} from './api.js';
import './styles.css';

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

const sourceTypes = [
  { value: 'course', label: 'Course' },
  { value: 'manual', label: 'Manual / PDF' },
  { value: 'inbox', label: 'Inbox' },
  { value: 'newsletter', label: 'Newsletter' },
  { value: 'tasklist', label: 'Task Batch' },
  { value: 'url', label: 'Web URL' },
  { value: 'ebook', label: 'eBook / Notes' },
  { value: 'audio', label: 'Audio Transcript' },
];

const targets = [
  { value: 'browser', label: 'Browser', note: 'Immediate playable session' },
  { value: 'unity', label: 'Unity', note: 'Queued engine build' },
  { value: 'unreal', label: 'Unreal', note: 'Queued engine build' },
  { value: 'blender', label: 'Blender', note: 'Queued glTF export' },
];

const genres = [
  { value: 'action-adventure-key-lock.v1', label: 'Action Adventure Key/Lock' },
  { value: 'arcade-collect-avoid.v1', label: 'Arcade Collect / Avoid' },
  { value: 'board-resource-sim.v1', label: 'Board Resource Simulation' },
  { value: 'fps-target-gallery.v1', label: 'FPS Target Gallery' },
  { value: 'idle-progress.v1', label: 'Idle Progress' },
  { value: 'memory-palace.v1', label: 'Memory Palace' },
  { value: 'open-world-courier.v1', label: 'Open World Courier' },
  { value: 'quest-rpg-progression.v1', label: 'Quest RPG Progression' },
  { value: 'router-failover-defense.v1', label: 'Router Failover Defense' },
  { value: 'runner-gauntlet.v1', label: 'Runner Gauntlet' },
  { value: 'sandbox-craft-build.v1', label: 'Sandbox Craft and Build' },
];

const domainLabels = {
  strategy: 'Strategy',
  science: 'Science',
  defense: 'Defense',
  engineering: 'Engineering',
  aiGenerated: 'AI Generated',
};

const domainFallbacks = {
  strategy: ['market', 'roadmap', 'competitor', 'growth', 'decision', 'client'],
  science: ['research', 'model', 'experiment', 'data', 'gradient', 'theory'],
  defense: ['security', 'risk', 'threat', 'compliance', 'credential', 'breach'],
  engineering: ['system', 'api', 'build', 'deploy', 'power', 'workflow', 'infrastructure'],
  aiGenerated: ['ai-generated', 'ai-generated'],
};

const mapNodes = [
  { id: 'science-peak', name: 'Science Peak', domain: 'science', x: 50, y: 16, summary: 'Research models, methods, and experimental proof.' },
  { id: 'defense-perimeter', name: 'Defense Perimeter', domain: 'defense', x: 22, y: 38, summary: 'Risk review, controls, escalation, and threat evidence.' },
  { id: 'engineering-city', name: 'Engineering City', domain: 'engineering', x: 78, y: 38, summary: 'Systems, APIs, deployment paths, and operational mechanics.' },
  { id: 'capital', name: 'Knowledge Capital', domain: 'all', x: 50, y: 52, summary: 'Profile, inventory, skill tree, and campaign progress.' },
  { id: 'strategy-harbor', name: 'Strategy Harbor', domain: 'strategy', x: 24, y: 78, summary: 'Planning, market context, prioritization, and business outcomes.' },
  { id: 'frontier', name: 'Future Frontier', domain: 'all', x: 76, y: 78, summary: 'Upcoming templates, engine targets, and worker artifacts.' },
  { id: 'defense-zone', name: 'Defense Zone', domain: 'defense', x: 22, y: 92, summary: 'Security, risk, and threat review.' },
  { id: 'engineering-factory', name: 'Engineering Factory', domain: 'engineering', x: 78, y: 92, summary: 'Systems, APIs, deployment paths, and operational mechanics.' },
  { id: 'science-lab', name: 'Science Lab', domain: 'science', x: 50, y: 106, summary: 'Research models, methods, and experimental proof.' },
  { id: 'market-place', name: 'Market Place', domain: 'market', x: 50, y: 120, summary: 'Marketplace, inventory, and worker artifacts.' },
  { id: 'strategy-mill', name: 'Strategy Mill', domain: 'strategy', x: 50, y: 134, summary: 'Planning, market context, prioritization, and business outcomes.' },
  { id: 'demo', name: 'Demo', domain: 'demo', x: 50, y: 150, summary: 'Demo' },
  { id: 'ai-generated', name: 'AI Generated', domain: 'aiGenerated', x: 50, y: 92, summary: 'AI-generated content, proof, and evidence.' },
];

const sampleText =
  'A training module covering threat detection, evidence review, escalation policy, risk scoring, and final operational readiness checks.';

function createInitialProfile() {
  return {
    name: 'Knowledge Specialist',
    totalXp: 0,
    level: 1,
    guildRank: 'Guild Rank I',
    domains: Object.fromEntries(Object.keys(domainLabels).map((domain) => [domain, { level: 1, xp: 0 }])),
    unlockedSkillIds: [],
    completedQuestsCount: 0,
    failedQuestsCount: 0,
    inventory: [],
    earnedAchievementIds: [],
  };
}

function createSourceItem(input) {
  return {
    id: `source-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    title: input.title || 'Untitled Source',
    sourceType: input.sourceType || 'manual',
    text: input.text || '',
    uri: input.uri || '',
    origin: input.origin || 'manual-entry',
    metadata: input.metadata || {},
  };
}

function normalizeArray(value) {
  if (Array.isArray(value)) return value;
  if (Array.isArray(value?.templates)) return value.templates;
  if (Array.isArray(value?.items)) return value.items;
  if (Array.isArray(value?.artifacts)) return value.artifacts;
  if (Array.isArray(value?.builds)) return value.builds;
  return [];
}

function statusClass(status) {
  if (status === 'succeeded') return 'good';
  if (status === 'failed' || status === 'cancelled') return 'bad';
  if (status === 'running') return 'live';
  return 'queued';
}

function buildCombinedText(items, draftText) {
  const itemText = items.map((item) => `# ${item.title}\n${item.text || item.uri || ''}`).join('\n\n');
  return [itemText, draftText].filter(Boolean).join('\n\n');
}

function publicGatewayBase() {
  try {
    const url = new URL(API_BASE);
    url.pathname = url.pathname.replace(/\/v1\/?$/, '');
    url.search = '';
    url.hash = '';
    coerceHttpForLocalGateway(url);
    return url.toString().replace(/\/$/, '');
  } catch (_) {
    try {
      const fallbackUrl = new URL(API_BASE.replace(/\/v1\/?$/, ''));
      coerceHttpForLocalGateway(fallbackUrl);
      return fallbackUrl.toString().replace(/\/$/, '');
    } catch (__) {
      return API_BASE.replace(/\/v1\/?$/, '');
    }
  }
}

function isLocalOrPrivateHost(hostname) {
  return hostname === 'localhost'
    || hostname === '127.0.0.1'
    || hostname.startsWith('192.168.')
    || hostname.startsWith('10.')
    || /^172\.(1[6-9]|2\d|3[0-1])\./.test(hostname);
}

function coerceHttpForLocalApi(url, apiUrl) {
  const sameHost = url.host === apiUrl.host;
  const samePort = url.port && url.port === apiUrl.port;
  const localOrPrivate = isLocalOrPrivateHost(url.hostname);
  if (apiUrl.protocol === 'http:' && url.protocol === 'https:' && (sameHost || samePort || localOrPrivate)) {
    url.protocol = 'http:';
  }
}

function coerceHttpForLocalGateway(url) {
  if (!isLocalOrPrivateHost(url.hostname)) return;
  const gatewayResource = url.port === '8080'
    || url.pathname.startsWith('/v1/browser-engine')
    || url.pathname.startsWith('/v1/objects');
  if (!gatewayResource) return;
  // Match the embedding page's scheme so the game (boot.js, manifest fetch) is
  // never mixed-content or HSTS-upgraded onto a server that can't speak it:
  //   http page  -> http game (unchanged local-dev behaviour)
  //   https page -> https game (requires the gateway to run with GATEWAY_HTTPS=true)
  // This is the fix for "A TLS error caused the secure connection to fail. (boot.js)".
  const pageProtocol = (typeof window !== 'undefined' && window.location && window.location.protocol) || 'http:';
  if (pageProtocol === 'http:' || pageProtocol === 'https:') {
    url.protocol = pageProtocol;
  }
}

function normalizeLaunchUrl(urlValue) {
  if (!urlValue) return '';
  try {
    const launchUrl = new URL(urlValue);
    const apiUrl = new URL(API_BASE);
    coerceHttpForLocalApi(launchUrl, apiUrl);
    coerceHttpForLocalGateway(launchUrl);

    const manifestUrl = launchUrl.searchParams.get('manifest');
    if (manifestUrl) {
      try {
        const nestedManifestUrl = new URL(manifestUrl);
        coerceHttpForLocalApi(nestedManifestUrl, apiUrl);
        coerceHttpForLocalGateway(nestedManifestUrl);
        launchUrl.searchParams.set('manifest', nestedManifestUrl.toString());
      } catch (_) {
        // Keep non-URL manifest values untouched.
      }
    }
    return launchUrl.toString();
  } catch (_) {
    return urlValue;
  }
}

function browserTemplateDemoUrl() {
  return normalizeLaunchUrl(`${publicGatewayBase()}/v1/browser-engine/demo.html`);
}

function gltfPreviewForArtifact(artifact) {
  if (!artifact) return null;
  const metadata = artifact.metadata || {};
  const directUrl = metadata.previewUrl || artifact.launchUrl || artifact.downloadUrl;
  const directText = String(directUrl || '');
  if (/\.(glb|gltf)(\?|#|$)/i.test(directText)) {
    return {
      url: normalizeLaunchUrl(directText),
      label: metadata.previewAssetPath || directText.split('/').pop() || 'glTF preview',
      artifact,
    };
  }
  if (metadata.previewUrl) {
    return {
      url: normalizeLaunchUrl(String(metadata.previewUrl)),
      label: metadata.previewAssetPath || 'StreamingAssets glTF preview',
      artifact,
    };
  }
  return null;
}

function gltfPreviewFromArtifacts(activeBuild, artifacts) {
  const ordered = [
    artifacts.find((artifact) => activeBuild?.artifactId && artifact.id === activeBuild.artifactId),
    ...artifacts,
  ].filter(Boolean);
  for (const artifact of ordered) {
    const preview = gltfPreviewForArtifact(artifact);
    if (preview) return preview;
  }
  return null;
}

function detectDomain(input = '') {
  const textValue = input.toLowerCase();
  const scored = Object.entries(domainFallbacks).map(([domain, terms]) => ({
    domain,
    score: terms.filter((term) => textValue.includes(term)).length,
  }));
  return scored.sort((a, b) => b.score - a.score)[0]?.score > 0 ? scored[0].domain : 'engineering';
}

function packageDomain(pkg, irx, fallbackText) {
  return String(
    pkg?.progression?.domain
      || pkg?.specification?.experienceManifest?.classification?.domain
      || pkg?.specification?.experienceManifest?.metadata?.domain
      || irx?.classification?.domain
      || detectDomain(`${pkg?.experience?.title || ''} ${fallbackText || ''}`),
  ).toLowerCase();
}

function questReward(quest, index = 0) {
  const reward = quest?.reward;
  if (typeof reward?.xp === 'number') return reward.xp;
  if (typeof reward === 'number') return reward;
  return 100 + index * 25;
}

function activeQuestFromPackage(pkg) {
  const quests = Array.isArray(pkg?.blueprint?.quests) ? pkg.blueprint.quests : [];
  return quests[0] || null;
}

function evidenceCandidatesForQuest(quest, sourceText) {
  const fromQuest = Array.isArray(quest?.evidence) ? quest.evidence : [];
  if (fromQuest.length) {
    return fromQuest.map((candidate, index) => ({
      id: `candidate-${index}`,
      text: String(candidate.text || candidate.label || candidate),
      correct: candidate.correct !== false,
    }));
  }

  const sentences = String(sourceText || quest?.summary || 'Complete the generated mission.')
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => sentence.trim())
    .filter(Boolean)
    .slice(0, 4);
  return sentences.map((sentence, index) => ({ id: `candidate-${index}`, text: sentence, correct: true }));
}

function derivedSkillTree(pkg, domain) {
  const manifestSkills = pkg?.specification?.experienceManifest?.skillTree || pkg?.progression?.skillTree;
  if (Array.isArray(manifestSkills) && manifestSkills.length) return manifestSkills;
  return [
    { id: `${domain}-triage`, name: `${domainLabels[domain] || 'Knowledge'} Triage`, description: 'Identify useful source signals quickly.', category: domain },
    { id: `${domain}-evidence`, name: 'Evidence Binding', description: 'Tie each quest objective back to source snippets.', category: domain },
    { id: `${domain}-runtime`, name: 'Runtime Transfer', description: 'Apply compiled knowledge inside playable missions and engine builds.', category: domain },
  ];
}

function rankedProfile(profile) {
  const nextLevel = Math.floor(profile.totalXp / 1000) + 1;
  const ranks = ['Guild Rank I', 'Guild Rank II', 'Guild Rank III', 'Guild Rank IV', 'Grand Sentinel'];
  return {
    ...profile,
    level: nextLevel,
    guildRank: ranks[Math.min(ranks.length - 1, nextLevel - 1)],
  };
}

function safeStorageGet(key) {
  try {
    return window.localStorage.getItem(key);
  } catch (_) {
    return null;
  }
}

function safeStorageSet(key, value) {
  try {
    window.localStorage.setItem(key, value);
  } catch (_) {
    // Some browser/privacy contexts block storage; profile state still works in memory.
  }
}

async function extractFileText(file) {
  const lowerName = file.name.toLowerCase();
  if (file.type === 'application/pdf' || lowerName.endsWith('.pdf')) {
    const data = await file.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data }).promise;
    const pages = [];
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
      const page = await pdf.getPage(pageNumber);
      const content = await page.getTextContent();
      pages.push(content.items.map((item) => item.str).join(' '));
    }
    return {
      sourceType: 'manual',
      title: file.name,
      text: pages.join('\n\n').trim() || `PDF uploaded: ${file.name}`,
      origin: 'pdf-upload',
      metadata: { fileName: file.name, mimeType: file.type, pages: pdf.numPages },
    };
  }

  if (file.type.startsWith('audio/') || /\.(mp3|wav|m4a|aac|ogg)$/i.test(file.name)) {
    return transcribeAudioFile(file);
  }

  const text = await file.text();
  return {
    sourceType: inferFileSourceType(file),
    title: file.name,
    text: text.trim() || `File uploaded: ${file.name}`,
    origin: 'file-upload',
    metadata: { fileName: file.name, mimeType: file.type },
  };
}

async function transcribeAudioFile(file) {
  try {
    const dataBase64 = await fileToBase64(file);
    const result = await transcribeAudio({
      fileName: file.name,
      mimeType: file.type || inferAudioMimeType(file.name),
      dataBase64,
    });
    const transcription = result.transcription;
    return {
      sourceType: 'audio',
      title: file.name,
      text: transcription.text,
      origin: `${transcription.provider}-transcription`,
      metadata: {
        fileName: file.name,
        mimeType: file.type,
        provider: transcription.provider,
        model: transcription.model,
        transcribedAt: transcription.transcribedAt,
      },
    };
  } catch (error) {
    return {
      sourceType: 'audio',
      title: file.name,
      text: `Audio file uploaded: ${file.name}. Automatic transcription failed: ${error.message}. Add or paste a transcript so the AI can convert the course into objectives, evidence, and achievements.`,
      origin: 'audio-upload',
      metadata: { fileName: file.name, mimeType: file.type, requiresTranscription: true, transcriptionError: error.message },
    };
  }
}

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',')[1] || '');
    reader.onerror = () => reject(new Error('Could not read audio file.'));
    reader.readAsDataURL(file);
  });
}

function inferAudioMimeType(fileName) {
  const lowerName = fileName.toLowerCase();
  if (lowerName.endsWith('.mp3')) return 'audio/mpeg';
  if (lowerName.endsWith('.m4a')) return 'audio/mp4';
  if (lowerName.endsWith('.ogg')) return 'audio/ogg';
  if (lowerName.endsWith('.webm')) return 'audio/webm';
  return 'audio/wav';
}

function inferFileSourceType(file) {
  const name = file.name.toLowerCase();
  if (name.endsWith('.md') || name.endsWith('.markdown') || name.endsWith('.epub')) return 'ebook';
  if (name.endsWith('.csv') || name.endsWith('.json')) return 'tasklist';
  if (name.endsWith('.vtt') || name.endsWith('.srt')) return 'audio';
  if (name.endsWith('.html') || name.endsWith('.htm')) return 'newsletter';
  return 'manual';
}

function App() {
  const [sourceType, setSourceType] = useState('course');
  const [target, setTarget] = useState('browser');
  const [title, setTitle] = useState('Operational Readiness Mission');
  const [worldTitle, setWorldTitle] = useState('Knowledge Frontier');
  const [genre, setGenre] = useState('action-adventure-key-lock.v1');
  const [text, setText] = useState(sampleText);
  const [goals, setGoals] = useState('Help the user master the operational readiness process.');
  const [achievements, setAchievements] = useState('Complete first mission, identify correct evidence, unlock readiness badge.');
  const [useAiCompiler, setUseAiCompiler] = useState(false);
  const [aiProvider, setAiProvider] = useState('openai');
  const [aiModel, setAiModel] = useState('gpt-4o-mini');
  const [apiKeys, setApiKeys] = useState({ openai: '', claude: '', gemini: '' });
  const [urlInput, setUrlInput] = useState('');
  const [emailDraft, setEmailDraft] = useState('');
  const [inboxProtocol, setInboxProtocol] = useState('imap');
  const [inboxHost, setInboxHost] = useState('');
  const [inboxPort, setInboxPort] = useState('993');
  const [inboxSecure, setInboxSecure] = useState(true);
  const [inboxUsername, setInboxUsername] = useState('');
  const [inboxPassword, setInboxPassword] = useState('');
  const [inboxMailbox, setInboxMailbox] = useState('INBOX');
  const [inboxLimit, setInboxLimit] = useState(25);
  const [transcriptDraft, setTranscriptDraft] = useState('');
  const [ingestedItems, setIngestedItems] = useState(() => [
    createSourceItem({
      sourceType: 'course',
      title: 'Sample readiness module',
      text: sampleText,
      origin: 'sample',
    }),
  ]);
  const [irx, setIrx] = useState(null);
  const [preprocessingPipeline, setPreprocessingPipeline] = useState(null);
  const [compiledPackage, setCompiledPackage] = useState(null);
  const [activeBuild, setActiveBuild] = useState(null);
  const [builds, setBuilds] = useState([]);
  const [artifacts, setArtifacts] = useState([]);
  const [templates, setTemplates] = useState([]);
  const [health, setHealth] = useState(null);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [activeView, setActiveView] = useState('compiler');
  const [profile, setProfile] = useState(() => {
    try {
      return rankedProfile({ ...createInitialProfile(), ...(JSON.parse(safeStorageGet('optomole_profile_v3') || 'null') || {}) });
    } catch (_) {
      return createInitialProfile();
    }
  });
  const [selectedMapNodeId, setSelectedMapNodeId] = useState('capital');
  const [selectedEvidenceIds, setSelectedEvidenceIds] = useState([]);
  const [missionResult, setMissionResult] = useState(null);

  const payload = useMemo(
    () => ({
      source: {
        sourceType,
        title,
        text: buildCombinedText(ingestedItems, text),
        metadata: {
          submittedFrom: 'optomole-frontend',
          irx,
          preprocessingPipeline,
          goals,
          achievements,
        },
      },
      options: {
        title,
        worldTitle,
        genre,
        goals,
        achievements,
        publicGatewayUrl: publicGatewayBase(),
        ai: useAiCompiler
          ? {
            provider: aiProvider,
            model: aiModel,
            apiKeys,
          }
          : undefined,
      },
      target,
    }),
    [achievements, aiModel, aiProvider, apiKeys, genre, goals, ingestedItems, irx, preprocessingPipeline, sourceType, target, text, title, useAiCompiler, worldTitle],
  );

  const activeQuest = activeQuestFromPackage(compiledPackage);
  const activeDomain = packageDomain(compiledPackage, irx, payload.source.text);
  const activeEvidence = useMemo(
    () => evidenceCandidatesForQuest(activeQuest, payload.source.text),
    [activeQuest, payload.source.text],
  );
  const activeReward = questReward(activeQuest, 0);
  const skillTree = useMemo(() => derivedSkillTree(compiledPackage, activeDomain), [compiledPackage, activeDomain]);
  const selectedMapNode = mapNodes.find((node) => node.id === selectedMapNodeId) || mapNodes[3];
  const activePipeline = preprocessingPipeline || irx?.preprocessingPipeline || compiledPackage?.specification?.preprocessing || null;

  useEffect(() => {
    safeStorageSet('optomole_profile_v3', JSON.stringify(profile));
  }, [profile]);

  useEffect(() => {
    setSelectedEvidenceIds([]);
    setMissionResult(null);
  }, [compiledPackage?.id, activeQuest?.id]);

  async function refreshSideData() {
    const [templateData, buildData, artifactData] = await Promise.allSettled([
      listTemplates(),
      listBuilds(),
      listArtifacts(),
    ]);

    if (templateData.status === 'fulfilled') setTemplates(normalizeArray(templateData.value));
    if (buildData.status === 'fulfilled') setBuilds(normalizeArray(buildData.value));
    if (artifactData.status === 'fulfilled') setArtifacts(normalizeArray(artifactData.value));
  }

  useEffect(() => {
    let mounted = true;

    async function boot() {
      try {
        const [healthData] = await Promise.all([getHealth(), refreshSideData()]);
        if (mounted) setHealth(healthData);
      } catch (caught) {
        if (mounted) setError(caught.message);
      }
    }

    boot();
    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    if (!activeBuild?.id || ['succeeded', 'failed', 'cancelled'].includes(activeBuild.status)) return undefined;

    const timer = window.setInterval(async () => {
      try {
        const data = await getBuild(activeBuild.id);
        setActiveBuild(data.build);
        await refreshSideData();
      } catch (caught) {
        setError(caught.message);
      }
    }, 2500);

    return () => window.clearInterval(timer);
  }, [activeBuild?.id, activeBuild?.status]);

  function addIngestedItem(item) {
    setIngestedItems((current) => [createSourceItem(item), ...current]);
  }

  async function handleFiles(event) {
    const files = [...(event.target.files || [])];
    if (!files.length) return;
    setBusy('ingest');
    setError('');
    try {
      const extracted = await Promise.all(files.map(extractFileText));
      setIngestedItems((current) => [...extracted.map(createSourceItem), ...current]);
      const first = extracted[0];
      if (first?.title) setTitle((current) => current || first.title);
      if (first?.sourceType) setSourceType(first.sourceType);
    } catch (caught) {
      setError(caught.message);
    } finally {
      event.target.value = '';
      setBusy('');
    }
  }

  function ingestPaste() {
    if (!text.trim()) {
      setError('Paste source content before adding it to ingestion.');
      return;
    }
    addIngestedItem({ sourceType, title, text, origin: 'pasted-text' });
  }

  function ingestUrl() {
    const value = urlInput.trim();
    if (!value) {
      setError('Enter a URL before adding it to ingestion.');
      return;
    }
    addIngestedItem({
      sourceType: 'url',
      title: title || value,
      text: `URL source submitted for AI retrieval or summarization: ${value}`,
      uri: value,
      origin: 'url',
    });
    setUrlInput('');
  }

  function ingestEmail() {
    if (!emailDraft.trim()) {
      setError('Paste email content before adding it to ingestion.');
      return;
    }
    addIngestedItem({ sourceType: 'inbox', title: title || 'Email Source', text: emailDraft, origin: 'email-paste' });
    setEmailDraft('');
    setSourceType('inbox');
  }

  async function connectInbox() {
    if (!inboxHost.trim() || !inboxUsername.trim()) {
      setError('Enter an inbox host and username before connecting.');
      return;
    }

    setBusy('inbox');
    setError('');
    try {
      const data = await connectEmailInbox({
        protocol: inboxProtocol,
        host: inboxHost.trim(),
        port: Number(inboxPort),
        secure: inboxSecure,
        username: inboxUsername.trim(),
        password: inboxPassword,
        mailbox: inboxMailbox.trim() || 'INBOX',
        limit: Number(inboxLimit) || 25,
      });
      addIngestedItem(data.source);
      setSourceType('inbox');
      setInboxPassword('');
    } catch (caught) {
      setError(caught.message);
    } finally {
      setBusy('');
    }
  }

  function ingestTranscript() {
    if (!transcriptDraft.trim()) {
      setError('Paste an audio course transcript before adding it to ingestion.');
      return;
    }
    addIngestedItem({ sourceType: 'audio', title: title || 'Audio Course Transcript', text: transcriptDraft, origin: 'audio-transcript' });
    setTranscriptDraft('');
    setSourceType('audio');
  }

  function removeIngestedItem(id) {
    setIngestedItems((current) => current.filter((item) => item.id !== id));
  }

  function persistProfile(update) {
    setProfile((current) => rankedProfile(typeof update === 'function' ? update(current) : update));
  }

  function completeMission(mode = 'analysis') {
    if (!activeQuest) {
      setMissionResult({ ok: false, message: 'Compile a package before running a mission.' });
      return;
    }

    const correctIds = activeEvidence.filter((candidate) => candidate.correct).map((candidate) => candidate.id).sort();
    const selectedIds = [...selectedEvidenceIds].sort();
    const passed = correctIds.length > 0
      && correctIds.length === selectedIds.length
      && correctIds.every((idValue, index) => idValue === selectedIds[index]);

    if (!passed) {
      setMissionResult({ ok: false, message: 'Evidence set rejected. Remove distractors and include every source-backed snippet.' });
      persistProfile((current) => ({ ...current, failedQuestsCount: current.failedQuestsCount + 1 }));
      return;
    }

    const loot = compiledPackage?.progression?.loot?.[0] || activeQuest?.reward?.item || `${domainLabels[activeDomain] || 'Knowledge'} Insight`;
    persistProfile((current) => {
      const domainState = current.domains[activeDomain] || { level: 1, xp: 0 };
      const nextDomainXp = domainState.xp + activeReward;
      return {
        ...current,
        totalXp: current.totalXp + activeReward,
        completedQuestsCount: current.completedQuestsCount + 1,
        domains: {
          ...current.domains,
          [activeDomain]: {
            level: Math.floor(nextDomainXp / 400) + 1,
            xp: nextDomainXp,
          },
        },
        inventory: current.inventory.includes(loot) ? current.inventory : [...current.inventory, loot],
        earnedAchievementIds: current.earnedAchievementIds.includes(`mission-${activeQuest.id || mode}`)
          ? current.earnedAchievementIds
          : [...current.earnedAchievementIds, `mission-${activeQuest.id || mode}`],
      };
    });
    setMissionResult({ ok: true, message: `Mission cleared. +${activeReward} ${domainLabels[activeDomain] || activeDomain} XP and ${loot} added.` });
  }

  function unlockSkill(skillId) {
    persistProfile((current) => {
      const maxSkills = current.level * 2;
      if (current.unlockedSkillIds.includes(skillId) || current.unlockedSkillIds.length >= maxSkills) return current;
      return { ...current, unlockedSkillIds: [...current.unlockedSkillIds, skillId] };
    });
  }

  async function buildIrx() {
    const data = await normalizeIrx({
      source: payload.source,
      items: ingestedItems,
      goals,
      achievements,
      options: {
        ...payload.options,
        target,
      },
    });
    setIrx(data.irx);
    setPreprocessingPipeline(data.preprocessingPipeline || data.irx?.preprocessingPipeline || null);
    return data;
  }

  async function runSemanticPipeline() {
    setBusy('semantic');
    setError('');
    try {
      const data = await runPreprocessing({
        source: payload.source,
        items: ingestedItems,
        goals,
        achievements,
        options: {
          ...payload.options,
          target,
        },
      });
      setPreprocessingPipeline(data);
    } catch (caught) {
      setError(caught.message);
    } finally {
      setBusy('');
    }
  }

  async function runNormalizeIrx() {
    setBusy('irx');
    setError('');
    try {
      await buildIrx();
    } catch (caught) {
      setError(caught.message);
    } finally {
      setBusy('');
    }
  }

  async function runCompile() {
    setBusy('compile');
    setError('');
    try {
      const normalized = await buildIrx();
      const data = await compileExperience({
        source: normalized.source,
        options: payload.options,
      });
      setCompiledPackage(data.package);
      setActiveView('map');
    } catch (caught) {
      setError(caught.message);
    } finally {
      setBusy('');
    }
  }

  async function runLaunch() {
    setBusy('launch');
    setError('');
    try {
      const normalized = await buildIrx();
      const data = await launchExperience({
        ...payload,
        source: normalized.source,
      });
      setCompiledPackage(data.package);
      setActiveBuild(data.build);
      setActiveView('quest');
      await refreshSideData();
    } catch (caught) {
      setError(caught.message);
    } finally {
      setBusy('');
    }
  }

  const quests = Array.isArray(compiledPackage?.blueprint?.quests) ? compiledPackage.blueprint.quests : [];
  const playableUrl = normalizeLaunchUrl(activeBuild?.launchUrl || activeBuild?.downloadUrl);
  const demoUrl = browserTemplateDemoUrl();
  const gltfPreview = useMemo(() => gltfPreviewFromArtifacts(activeBuild, artifacts), [activeBuild, artifacts]);

  useEffect(() => {
    if (!gltfPreview) return undefined;
    const src = 'https://cdn.jsdelivr.net/npm/@google/model-viewer@4.1.0/dist/model-viewer.min.js';
    if (customElements.get('model-viewer') || document.querySelector(`script[src="${src}"]`)) return undefined;
    const script = document.createElement('script');
    script.type = 'module';
    script.src = src;
    document.head.appendChild(script);
    return undefined;
  }, [gltfPreview]);

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand">
          <img src="/images/Optomole.png" alt="" />
          <div>
            <p>Optomole Fabric</p>
            <h1>Build Console</h1>
          </div>
        </div>
        <div className="endpoint">
          <span className={health ? 'dot good-bg' : 'dot bad-bg'} />
          <div>
            <b>{health ? 'Gateway online' : 'Gateway unchecked'}</b>
            <span>{API_BASE}</span>
          </div>
        </div>
      </header>

      <nav className="modebar" aria-label="Runtime views">
        {[
          ['compiler', 'Compiler'],
          ['map', 'Knowledge Map'],
          ['quest', 'Quest Play'],
          ['profile', 'Capital'],
          ['worker', 'Worker'],
          ['demo', 'Demo'],
        ].map(([idValue, label]) => (
          idValue === 'demo' ? (
            <a
              key={idValue}
              className="mode-tab"
              href={demoUrl}
            >
              {label}
            </a>
          ) : (
            <button
              key={idValue}
              className={activeView === idValue ? 'mode-tab active' : 'mode-tab'}
              type="button"
              onClick={() => setActiveView(idValue)}
            >
              {label}
            </button>
          )
        ))}
      </nav>

      <main className="workspace">
        <section className="panel composer">
          <div className="section-title">
            <p>Ingestion</p>
            <h2>Create Game Build</h2>
          </div>

          <div className="ingest-grid">
            <label className="file-drop">
              <input
                type="file"
                multiple
                accept=".pdf,.txt,.md,.markdown,.html,.htm,.json,.csv,.vtt,.srt,.epub,.mp3,.wav,.m4a,.aac,.ogg,text/*,application/pdf,application/json,audio/*"
                onChange={handleFiles}
              />
              <b>{busy === 'ingest' ? 'Reading files...' : 'Upload source files'}</b>
              <span>PDF, text, markdown, HTML, JSON, CSV, ebook notes, transcripts, or audio files</span>
            </label>
            <div className="source-count">
              <b>{ingestedItems.length}</b>
              <span>source items queued</span>
            </div>
          </div>

          <label>
            Source type
            <select value={sourceType} onChange={(event) => setSourceType(event.target.value)}>
              {sourceTypes.map((item) => (
                <option value={item.value} key={item.value}>
                  {item.label}
                </option>
              ))}
            </select>
          </label>

          <label>
            Project title
            <input value={title} onChange={(event) => setTitle(event.target.value)} />
          </label>

          <div className="split">
            <label>
              World
              <input value={worldTitle} onChange={(event) => setWorldTitle(event.target.value)} />
            </label>
            <label>
              Genre
              <select value={genre} onChange={(event) => setGenre(event.target.value)}>
                {genres.map((item) => (
                  <option value={item.value} key={item.value}>
                    {item.label}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <label>
            Source content
            <textarea value={text} onChange={(event) => setText(event.target.value)} rows={9} />
          </label>

          <button className="secondary inline-action" type="button" onClick={ingestPaste} disabled={Boolean(busy)}>
            Add Pasted Content
          </button>

          <div className="split">
            <label>
              URL source
              <input value={urlInput} onChange={(event) => setUrlInput(event.target.value)} placeholder="https://example.com/course-or-article" />
            </label>
            <button className="secondary align-end" type="button" onClick={ingestUrl} disabled={Boolean(busy)}>
              Add URL
            </button>
          </div>

          <label>
            Email or newsletter
            <textarea value={emailDraft} onChange={(event) => setEmailDraft(event.target.value)} rows={4} placeholder="Paste email thread, newsletter issue, or inbox digest." />
          </label>
          <button className="secondary inline-action" type="button" onClick={ingestEmail} disabled={Boolean(busy)}>
            Add Email
          </button>

          <div className="inbox-box">
            <div className="split">
              <label>
                Inbox protocol
                <select
                  value={inboxProtocol}
                  onChange={(event) => {
                    const protocol = event.target.value;
                    setInboxProtocol(protocol);
                    setInboxPort(protocol === 'imap' ? '993' : '995');
                  }}
                >
                  <option value="imap">IMAP</option>
                  <option value="pop3">POP3</option>
                </select>
              </label>
              <label className="checkbox-row inbox-secure">
                <input type="checkbox" checked={inboxSecure} onChange={(event) => setInboxSecure(event.target.checked)} />
                <span>TLS / SSL</span>
              </label>
            </div>
            <div className="split">
              <label>
                Mail server
                <input value={inboxHost} onChange={(event) => setInboxHost(event.target.value)} placeholder="imap.example.com" />
              </label>
              <label>
                Port
                <input value={inboxPort} onChange={(event) => setInboxPort(event.target.value)} inputMode="numeric" />
              </label>
            </div>
            <div className="split">
              <label>
                Username
                <input value={inboxUsername} onChange={(event) => setInboxUsername(event.target.value)} placeholder="name@example.com" />
              </label>
              <label>
                App password
                <input type="password" value={inboxPassword} onChange={(event) => setInboxPassword(event.target.value)} placeholder="Used for this connection request only" />
              </label>
            </div>
            <div className="split">
              <label>
                Mailbox
                <input value={inboxMailbox} onChange={(event) => setInboxMailbox(event.target.value)} placeholder="INBOX" />
              </label>
              <label>
                Message limit
                <input type="number" min="1" max="100" value={inboxLimit} onChange={(event) => setInboxLimit(event.target.value)} />
              </label>
            </div>
            <button className="secondary inline-action" type="button" onClick={connectInbox} disabled={Boolean(busy)}>
              {busy === 'inbox' ? 'Connecting Inbox...' : 'Connect Inbox'}
            </button>
            <p className="muted">POP/IMAP credentials are submitted to the local gateway for this request and are not stored by the frontend.</p>
          </div>

          <label>
            Audio course transcript
            <textarea value={transcriptDraft} onChange={(event) => setTranscriptDraft(event.target.value)} rows={4} placeholder="Paste transcript, captions, VTT/SRT text, or lesson notes from audio/video courses." />
          </label>
          <button className="secondary inline-action" type="button" onClick={ingestTranscript} disabled={Boolean(busy)}>
            Add Transcript
          </button>

          <label>
            Goals
            <textarea value={goals} onChange={(event) => setGoals(event.target.value)} rows={3} placeholder="What should the player learn, do, or improve?" />
          </label>

          <label>
            Achievements
            <textarea value={achievements} onChange={(event) => setAchievements(event.target.value)} rows={3} placeholder="Badges, milestones, mastery checks, or completion outcomes." />
          </label>

          <div className="source-list">
            {ingestedItems.map((item) => (
              <article key={item.id}>
                <div>
                  <b>{item.title}</b>
                  <span>{item.sourceType} / {item.origin} / {(item.text || '').length} chars</span>
                </div>
                <button type="button" onClick={() => removeIngestedItem(item.id)}>Remove</button>
              </article>
            ))}
          </div>

          <div className="ai-compiler-box">
            <label className="checkbox-row">
              <input type="checkbox" checked={useAiCompiler} onChange={(event) => setUseAiCompiler(event.target.checked)} />
              <span>Use AI Experience Compiler</span>
            </label>
            {useAiCompiler ? (
              <>
                <div className="split">
                  <label>
                    Provider
                    <select
                      value={aiProvider}
                      onChange={(event) => {
                        const provider = event.target.value;
                        setAiProvider(provider);
                        setAiModel(provider === 'openai' ? 'gpt-4o-mini' : provider === 'claude' ? 'claude-3-5-sonnet-latest' : 'gemini-3.5-flash');
                      }}
                    >
                      <option value="openai">OpenAI</option>
                      <option value="claude">Claude</option>
                      <option value="gemini">Gemini</option>
                    </select>
                  </label>
                  <label>
                    Model
                    <input value={aiModel} onChange={(event) => setAiModel(event.target.value)} />
                  </label>
                </div>
                <label>
                  {aiProvider} API key
                  <input
                    type="password"
                    value={apiKeys[aiProvider] || ''}
                    onChange={(event) => setApiKeys((current) => ({ ...current, [aiProvider]: event.target.value }))}
                    placeholder="Used for this compile request only"
                  />
                </label>
                <p className="muted">The API key is sent to the local gateway for this compile request and is not stored by the frontend.</p>
              </>
            ) : null}
          </div>

          <div className="target-grid">
            {targets.map((item) => (
              <button
                className={target === item.value ? 'target-card selected' : 'target-card'}
                key={item.value}
                type="button"
                onClick={() => setTarget(item.value)}
              >
                <b>{item.label}</b>
                <span>{item.note}</span>
              </button>
            ))}
          </div>

          <div className="action-row">
            <button className="secondary" type="button" onClick={runSemanticPipeline} disabled={Boolean(busy)}>
              {busy === 'semantic' ? 'Extracting...' : 'Run Semantic Pipeline'}
            </button>
            <button className="secondary" type="button" onClick={runNormalizeIrx} disabled={Boolean(busy)}>
              {busy === 'irx' ? 'Normalizing...' : 'Normalize IRX'}
            </button>
          </div>
          <div className="action-row">
            <button className="secondary" type="button" onClick={runCompile} disabled={Boolean(busy)}>
              {busy === 'compile' ? 'Compiling...' : 'Compile Spec'}
            </button>
            <button className="primary" type="button" onClick={runLaunch} disabled={Boolean(busy)}>
              {busy === 'launch' ? 'Launching...' : 'Launch Build'}
            </button>
          </div>

          {error ? <div className="error-box">{error}</div> : null}
        </section>

        <section className="preview-stack">
          <div className="hero-panel">
            <img src="/images/display.png" alt="" />
            <div>
              <p>Generated Package</p>
              <h2>{compiledPackage?.experience?.title || 'No package compiled yet'}</h2>
              <span>{compiledPackage?.experience?.world?.planet || 'Waiting for source content'} / {domainLabels[activeDomain] || activeDomain}</span>
              {compiledPackage?.experience?.genre?.title ? (
                <span className="genre-chip">{compiledPackage.experience.genre.title}</span>
              ) : null}
            </div>
          </div>

          {activeView === 'map' ? (
            <div className="panel runtime-panel">
              <div className="section-title compact">
                <p>Living Map</p>
                <h2>{selectedMapNode.name}</h2>
              </div>
              <div className="map-board">
                <svg viewBox="0 0 100 100" aria-hidden="true">
                  <line x1="50" y1="16" x2="22" y2="38" />
                  <line x1="50" y1="16" x2="78" y2="38" />
                  <line x1="22" y1="38" x2="50" y2="52" />
                  <line x1="78" y1="38" x2="50" y2="52" />
                  <line x1="50" y1="52" x2="24" y2="78" />
                  <line x1="50" y1="52" x2="76" y2="78" />
                </svg>
                {mapNodes.map((node) => {
                  const hasQuest = node.domain === activeDomain;
                  return (
                    <button
                      key={node.id}
                      className={`map-node ${selectedMapNodeId === node.id ? 'selected' : ''} ${hasQuest ? 'has-quest' : ''}`}
                      style={{ left: `${node.x}%`, top: `${node.y}%` }}
                      type="button"
                      onClick={() => setSelectedMapNodeId(node.id)}
                    >
                      <b>{node.name}</b>
                      <span>{node.domain === 'all' ? 'All domains' : domainLabels[node.domain]}</span>
                    </button>
                  );
                })}
              </div>
              <div className="runtime-detail">
                <b>{selectedMapNode.summary}</b>
                <span>
                  {selectedMapNode.domain === activeDomain
                    ? `${activeQuest?.title || 'Compiled quest'} is active here for +${activeReward} XP.`
                    : selectedMapNode.domain === 'all'
                      ? `${profile.guildRank} / ${profile.totalXp} XP / ${profile.inventory.length} inventory items.`
                      : 'Compile content in this domain to activate a mission node.'}
                </span>
              </div>
            </div>
          ) : null}

          {activeView === 'quest' ? (
            <div className="panel runtime-panel">
              <div className="section-title compact">
                <p>Quest Play</p>
                <h2>{activeQuest?.title || 'No mission compiled'}</h2>
              </div>
              <p className="muted">{activeQuest?.summary || 'Compile a package to generate source-backed quest evidence.'}</p>
              <div className="evidence-list">
                {activeEvidence.map((candidate) => (
                  <button
                    key={candidate.id}
                    className={selectedEvidenceIds.includes(candidate.id) ? 'evidence-card selected' : 'evidence-card'}
                    type="button"
                    disabled={!activeQuest}
                    onClick={() => {
                      setSelectedEvidenceIds((current) => (
                        current.includes(candidate.id)
                          ? current.filter((idValue) => idValue !== candidate.id)
                          : [...current, candidate.id]
                      ));
                    }}
                  >
                    {candidate.text}
                  </button>
                ))}
              </div>
              <div className="action-row">
                <button className="secondary" type="button" onClick={() => setSelectedEvidenceIds([])} disabled={!selectedEvidenceIds.length}>
                  Reset Evidence
                </button>
                <button className="primary" type="button" onClick={() => completeMission('analyst')} disabled={!activeQuest}>
                  Confirm Analysis
                </button>
              </div>
              {missionResult ? <div className={missionResult.ok ? 'result-box good' : 'result-box bad'}>{missionResult.message}</div> : null}
            </div>
          ) : null}

          {activeView === 'profile' ? (
            <div className="panel runtime-panel">
              <div className="section-title compact">
                <p>Capital</p>
                <h2>{profile.name}</h2>
              </div>
              <dl className="facts">
                <div>
                  <dt>Level</dt>
                  <dd>{profile.level}</dd>
                </div>
                <div>
                  <dt>Total XP</dt>
                  <dd>{profile.totalXp}</dd>
                </div>
                <div>
                  <dt>Rank</dt>
                  <dd>{profile.guildRank}</dd>
                </div>
              </dl>
              <div className="domain-grid">
                {Object.entries(profile.domains).map(([domain, value]) => (
                  <div key={domain}>
                    <b>{domainLabels[domain] || domain}</b>
                    <span>LVL {value.level} / {value.xp} XP</span>
                  </div>
                ))}
              </div>
              <div className="skill-list">
                {skillTree.map((skill) => (
                  <button
                    key={skill.id}
                    className={profile.unlockedSkillIds.includes(skill.id) ? 'skill-card unlocked' : 'skill-card'}
                    type="button"
                    onClick={() => unlockSkill(skill.id)}
                  >
                    <b>{skill.name}</b>
                    <span>{skill.description}</span>
                  </button>
                ))}
              </div>
              <p className="muted">Inventory: {profile.inventory.length ? profile.inventory.join(', ') : 'No loot collected yet.'}</p>
            </div>
          ) : null}

          {activeView === 'worker' ? (
            <div className="panel runtime-panel">
              <div className="section-title compact">
                <p>Worker Contract</p>
                <h2>{activeBuild?.workerId || activeBuild?.target || 'No worker assigned'}</h2>
              </div>
              {activeBuild ? (
                <>
                  <dl className="facts">
                    <div>
                      <dt>Artifact</dt>
                      <dd>{activeBuild.artifactId || 'pending'}</dd>
                    </div>
                    <div>
                      <dt>Status</dt>
                      <dd>{activeBuild.status}</dd>
                    </div>
                    <div>
                      <dt>Target</dt>
                      <dd>{activeBuild.target}</dd>
                    </div>
                  </dl>
                  <pre>{JSON.stringify({ build: activeBuild, packageRuntime: compiledPackage?.runtimeContract, progression: compiledPackage?.progression }, null, 2)}</pre>
                </>
              ) : (
                <p className="muted">Launch a browser, Unity, or Unreal build to inspect queue and artifact metadata.</p>
              )}
            </div>
          ) : null}

          <div className="panel irx-panel">
            <div className="section-title compact">
              <p>Optomole IRX</p>
              <h2>{irx?.id || 'Not normalized yet'}</h2>
            </div>
            {irx ? (
              <>
                <dl className="facts">
                  <div>
                    <dt>Sources</dt>
                    <dd>{irx.source.itemCount}</dd>
                  </div>
                  <div>
                    <dt>Blocks</dt>
                    <dd>{irx.contentBlocks.length}</dd>
                  </div>
                  <div>
                    <dt>Signals</dt>
                    <dd>{irx.signals.keywords.length}</dd>
                  </div>
                </dl>
                <pre>{JSON.stringify(irx, null, 2)}</pre>
              </>
            ) : (
              <p className="muted">Normalize IRX to convert files, pasted content, URLs, email, transcripts, goals, and achievements into the canonical compiler contract.</p>
            )}
          </div>

          <div className="panel graph-panel">
            <div className="section-title compact">
              <p>Semantic Pipeline</p>
              <h2>{activePipeline?.knowledgeGraph?.id || 'No graph generated'}</h2>
            </div>
            {activePipeline ? (
              <>
                <dl className="facts">
                  <div>
                    <dt>Concepts</dt>
                    <dd>{activePipeline.semanticExtraction?.stats?.conceptCount || 0}</dd>
                  </div>
                  <div>
                    <dt>Scenes</dt>
                    <dd>{activePipeline.storyboard?.coverage?.sceneCount || 0}</dd>
                  </div>
                  <div>
                    <dt>KG Edges</dt>
                    <dd>{activePipeline.knowledgeGraph?.stats?.edgeCount || 0}</dd>
                  </div>
                </dl>
                <div className="graph-summary">
                  {(activePipeline.storyboard?.scenes || []).slice(0, 4).map((scene) => (
                    <article key={scene.id}>
                      <b>{scene.title}</b>
                      <span>{scene.sceneType} / {(scene.gameplayAtomIds || []).length} atoms</span>
                    </article>
                  ))}
                </div>
                <pre>{JSON.stringify(activePipeline, null, 2)}</pre>
              </>
            ) : (
              <p className="muted">Run the semantic pipeline or normalize IRX to extract concepts, normalize them into gameplay atoms, storyboard scenes, and publish a knowledge graph.</p>
            )}
          </div>

          <div className="panel status-panel">
            <div className="section-title compact">
              <p>Build Status</p>
              <h2>{activeBuild?.id || 'No active build'}</h2>
            </div>
            {activeBuild ? (
              <>
                <div className={`status-pill ${statusClass(activeBuild.status)}`}>{activeBuild.status}</div>
                <dl className="facts">
                  <div>
                    <dt>Target</dt>
                    <dd>{activeBuild.target}</dd>
                  </div>
                  <div>
                    <dt>Experience</dt>
                    <dd>{activeBuild.experienceId}</dd>
                  </div>
                  <div>
                    <dt>Updated</dt>
                    <dd>{new Date(activeBuild.updatedAt).toLocaleTimeString()}</dd>
                  </div>
                </dl>
                <div className="log-box">
                  {(activeBuild.logs || []).map((line, index) => (
                    <p key={`${line}-${index}`}>{line}</p>
                  ))}
                </div>
                {playableUrl ? (
                  <>
                    <a className="launch-link" href={playableUrl} target="_blank" rel="noreferrer">
                      Open Playable
                    </a>
                    <span className="debug-url">{playableUrl}</span>
                  </>
                ) : null}
              </>
            ) : (
              <p className="muted">Launch a build to track queue state, worker logs, and output artifacts.</p>
            )}
          </div>

          <div className="panel quest-panel">
            <div className="section-title compact">
              <p>Spec Preview</p>
              <h2>{quests.length} quest nodes</h2>
            </div>
            {quests.length ? (
              <div className="quest-list">
                {quests.map((quest) => (
                  <article key={quest.id || quest.title}>
                    <b>{quest.title}</b>
                    <span>{quest.summary}</span>
                  </article>
                ))}
              </div>
            ) : (
              <pre>{compiledPackage ? JSON.stringify(compiledPackage, null, 2) : 'Compile a package to preview the generated game specification.'}</pre>
            )}
          </div>
        </section>

        <aside className="right-rail">
          <section className="panel">
            <div className="section-title compact">
              <p>Templates</p>
              <h2>{templates.length} available</h2>
            </div>
            <div className="mini-list">
              {templates.slice(0, 6).map((template) => (
                <div key={template.id || template.name || template.title}>
                  <b>{template.name || template.title || template.id}</b>
                  <span>{template.id}</span>
                </div>
              ))}
              {!templates.length ? <span className="muted">Gateway has not returned templates yet.</span> : null}
            </div>
          </section>

          <section className="panel">
            <div className="section-title compact">
              <p>Recent Builds</p>
              <h2>{builds.length} jobs</h2>
            </div>
            <div className="mini-list">
              {builds.slice(0, 6).map((build) => (
                <button type="button" key={build.id} onClick={() => setActiveBuild(build)}>
                  <b>{build.id}</b>
                  <span>{build.target} / {build.status}</span>
                </button>
              ))}
              {!builds.length ? <span className="muted">No builds have been created in this gateway process.</span> : null}
            </div>
          </section>

          <section className="panel artifact-card">
            <div>
              <p>Artifacts</p>
              <h2>{artifacts.length}</h2>
            </div>
            <img src="/images/holoCard.png" alt="" />
          </section>

          <section className="panel gltf-panel">
            <div className="section-title compact">
              <p>StreamingAssets</p>
              <h2>glTF Preview</h2>
            </div>
            {gltfPreview ? (
              <>
                <model-viewer
                  className="gltf-viewer"
                  src={gltfPreview.url}
                  camera-controls
                  auto-rotate
                  shadow-intensity="0.75"
                  exposure="0.9"
                />
                <div className="gltf-meta">
                  <b>{gltfPreview.label}</b>
                  <span>{gltfPreview.artifact.target} / {gltfPreview.artifact.kind}</span>
                </div>
                <a className="launch-link" href={gltfPreview.url} target="_blank" rel="noreferrer">
                  Open glTF
                </a>
              </>
            ) : (
              <p className="muted">Launch a Blender export or an engine build with a `.glb` / `.gltf` in StreamingAssets to preview it here.</p>
            )}
          </section>
        </aside>
      </main>

      {/* Background video <video
        className="engine-loop"
        src="/OptomoleEngine.mp4"
        autoPlay
        loop
        muted
        playsInline
        aria-label="Optomole engine preview"
      />*/}
    </div>
  );
}

createRoot(document.getElementById('root')).render(<App />);
