import {
  GRAPH_VIEW_KEY,
  GRAPH_VIEW_SCHEMA,
  GraphViewState,
  clearViewState,
  loadViewState,
  parseViewState,
  saveViewState,
} from './saved-view';

function memStorage(): Storage {
  const map = new Map<string, string>();
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
    clear: () => map.clear(),
    key: () => null,
    length: 0,
  } as Storage;
}

const STATE: GraphViewState = {
  schema: GRAPH_VIEW_SCHEMA,
  mode: 'canvas',
  layout: 'breadthfirst',
  layoutAuto: false,
  query: 'kiro',
  kind: 'skill',
  selectedNode: 'skill:kiro-spec',
  selectedEdge: null,
  viewport: { zoom: 1.4, panX: 12, panY: -30 },
  groupBy: 'forge',
  collapsedGroups: ['grp:forge:unscoped'],
  // lf-0023: provider filter is part of view state; a record without it
  // parses back as null (all providers) — scope/viewIdx stay optional
  // and absent (toEqual ignores undefined-valued keys).
  provider: null,
};

describe('saved view state — forge-portal/graph-view/v1', () => {
  it('round-trips a full state through storage', () => {
    const s = memStorage();
    expect(saveViewState(s, STATE)).toBe(true);
    expect(loadViewState(s)).toEqual(STATE);
  });

  it('returns null for absent, corrupt and foreign payloads', () => {
    const s = memStorage();
    expect(loadViewState(s)).toBeNull();
    s.setItem(GRAPH_VIEW_KEY, '{broken');
    expect(loadViewState(s)).toBeNull();
    s.setItem(GRAPH_VIEW_KEY, JSON.stringify({ schema: 'other/v9' }));
    expect(loadViewState(s)).toBeNull();
    s.setItem(GRAPH_VIEW_KEY, JSON.stringify({ schema: GRAPH_VIEW_SCHEMA, mode: 'x' }));
    expect(loadViewState(s)).toBeNull();
  });

  it('validates enums and tolerates partial optional fields', () => {
    expect(parseViewState({ ...STATE, layout: 'bogus' })).toBeNull();
    expect(parseViewState({ ...STATE, mode: 'grid' })).toBeNull();
    const min = parseViewState({ schema: GRAPH_VIEW_SCHEMA, mode: 'list', layout: 'cose' });
    expect(min).not.toBeNull();
    expect(min!.query).toBe('');
    expect(min!.viewport).toBeNull();
    expect(min!.collapsedGroups).toEqual([]);
    // malformed viewport → null field, not a crash
    expect(parseViewState({ ...STATE, viewport: { zoom: 'x' } })!.viewport).toBeNull();
    // pre-cycle-3 records carry no layoutAuto → auto is the default
    const legacy = { ...STATE } as Record<string, unknown>;
    delete legacy['layoutAuto'];
    expect(parseViewState(legacy)!.layoutAuto).toBe(true);
  });

  it('clearViewState removes the record', () => {
    const s = memStorage();
    saveViewState(s, STATE);
    clearViewState(s);
    expect(loadViewState(s)).toBeNull();
  });

  it('storage failures degrade to null/false, never throw', () => {
    const broken = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('quota');
      },
      removeItem: () => {},
    };
    expect(loadViewState(broken)).toBeNull();
    expect(saveViewState(broken, STATE)).toBe(false);
    expect(loadViewState(null)).toBeNull();
    expect(saveViewState(null, STATE)).toBe(false);
  });
});
