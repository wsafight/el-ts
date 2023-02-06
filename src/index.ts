interface Cache {
  d: Record<string, any>
  clear: () => void
}
class Raw extends String {}

export class El extends HTMLElement {
  static els: Record<string, El> = {}
  static stash: Record<string, string> = {}
  static tags: Record<string, boolean> = {}
  static keys = new WeakMap()
  static styles: Record<string, string> = {}
  static deps: Record<string, any> = {}
  static Raw = Raw
  static _contextId: string | null

  static style: string

  _id: string

  _created: boolean = false

  readonly _cache: Cache = { d: {}, clear: () => (this._cache.d = {}) }
  _queued?: number

  created?: () => void
  mounted?: () => void
  unmounted?: () => void
  styles?: (params: Function) => string

  render?: (html: Function) => string

  constructor() {
    super()
    this._id = `${this.tagName}:${
      this.getAttribute('key') || Math.random().toString(36).slice(2)
    }`
    El.style = El.style || El.importStyle()
    this.$html = Object.assign(this.$html.bind(this), {
      raw: (x: string) => new El.Raw(x),
    })
    this._memoize()
    this.$update = this.$update.bind(this)
  }
  connectedCallback() {
    El._contextId = this._id
    this._unstash()
    if (!this._created && this.created) {
      this.created()
      this._created = true
    }
    El.els[this._id] = this
    this._update()
    this.mounted && this.mounted()
    if (El.tags[this.tagName] && !this.getAttribute('key'))
      console.warn(
        `Each ${this.tagName} should have a unique \`key\` attribute`
      )
    El.tags[this.tagName] = true
  }

  disconnectedCallback() {
    this.unmounted?.()
  }

  _memoize() {
    const descriptors = Object.getOwnPropertyDescriptors(
      this.constructor.prototype
    )
    for (const [key, d] of Object.entries(descriptors).filter((x) => x[1].get))
      Object.defineProperty(this.constructor.prototype, key, {
        get() {
          return key in this._cache.d
            ? this._cache.d[key]
            : (this._cache.d[key] = d.get!.call(this))
        },
      })
    this.constructor.prototype._memoize = new Function()
  }
  $update() {
    this._queued =
      this._queued ||
      requestAnimationFrame(() => {
        this._update()
        delete this._queued
      })
  }

  _update() {
    El._contextId = this._id
    this._cache.clear()
    this._unstash()
    const html = this.render && this.render(this.$html)
    const shadow = this.shadowRoot || this.attachShadow({ mode: 'open' })
    El.styles[this.tagName] =
      El.styles[this.tagName] ||
      `<link rel="stylesheet" href="data:text/css;base64,${btoa(
        El.style + this.styles?.(El.zcss) || ''
      )}">`
    El.morph(
      shadow,
      document
        .createRange()
        .createContextualFragment(El.styles[this.tagName] + html)
    )
    this._unstash()
    El._contextId = null
  }
  _unstash() {
    const camel = (s: string) => s.replace(/-\w/g, (c) => c[1].toUpperCase())
    const _contextId = El._contextId
    El._contextId = this._id

    const allEl: any = (this.shadowRoot || this).querySelectorAll('*')
    for (const el of [...allEl, this]) {
      for (const attr of el.attributes) {
        if (attr.value in El.stash) {
          el[camel(attr.name)] = El.stash[attr.value]
        } else if (attr.name in el.__proto__) {
        } else {
          try {
            el[camel(attr.name)] = attr.value
          } catch {}
        }
      }
    }

    El._contextId = _contextId
  }
  get $refs() {
    return new Proxy(
      {},
      {
        get: (_obj, key: string) =>
          this.shadowRoot!.querySelector(`[ref="${key}"]`),
      }
    )
  }
  $watch(_: any, fn: Function) {
    const currentDep = El.dep as any
    if (!currentDep._path) return
    El.deps[currentDep._path] = El.deps[currentDep._path] || {}
    El.deps[currentDep._path][Math.random()] = fn
    currentDep._path = null
  }
  $observable() {
    // @ts-ignore
    return El.observable(...arguments)
  }
  $nextTick() {
    return El.nextTick()
  }
  $html(strings: Record<string, any>, ...vals: any) {
    for (const [i] of strings.entries()) {
      if (
        (typeof vals[i]).match(/object|function/) &&
        strings[i].endsWith('=')
      ) {
        vals[i] = typeof vals[i] == 'function' ? vals[i].bind(this) : vals[i]
        const key =
          El.keys.get(vals[i].__target__ || vals[i]) ||
          'el:' + Math.random().toString(36).slice(2)
        El.keys.set(vals[i].__target__ || vals[i], key)
        El.stash[key] = vals[i]
        vals[i] = JSON.stringify(key)
      } else if (strings[i].endsWith('=')) vals[i] = JSON.stringify(vals[i])
      else if (vals[i] instanceof Array) vals[i] = vals[i].join('')
      else vals[i] = El.escape(vals[i])
    }
    return new El.Raw(
      strings.map((s: any, i: number) => {
        const data = [s, vals[i]] as any
        return data.join``
      }).join``
    )
  }
  static importStyle(): string {
    const srcList: string[] = []
    for (const el of document.querySelectorAll(
      'style, link[rel="stylesheet"]'
    ) as any) {
      srcList.push(
        el.tagName === 'STYLE' ? el.innerHTML : `\n@import url(${el.href});\n`
      )
    }
    return srcList.join('')
  }
  static notify(path: string): void {
    for (const id in El.deps[path] || {}) {
      setTimeout((_) => El.deps[path][id]())
    }
  }
  static dep(path: string) {
    const currentDep = El.dep as any
    currentDep._path = !El._contextId && path
    if (!El._contextId) return true
    const contextId = El._contextId
    El.deps[path] = El.deps[path] || {}
    return (El.deps[path][El._contextId] = () => El.els[contextId].$update())
  }

  static observable(
    x: any,
    path: string = Math.random().toString(36).slice(2)
  ): any {
    if ((typeof x != 'object' || x === null) && El.dep(path)) return x
    return new Proxy(x, {
      set(_x, key: string) {
        // @ts-ignore
        return (El.notify(path + '/' + key) as any) || Reflect.set(...arguments)
      },
      get(_x, key) {
        return x.__target__
          ? x[key]
          : typeof key == 'symbol'
          ? // @ts-ignore
            Reflect.get(...arguments)
          : key in x.constructor.prototype && El.dep(path + '/' + key)
          ? x[key]
          : key === '__target__'
          ? x
          : El.observable(x[key], path + '/' + key)
      },
    })
  }
  static morph(l: any, r: any) {
    let ls = 0,
      rs = 0,
      le = l.childNodes.length,
      re = r.childNodes.length
    const lc = [...l.childNodes],
      rc = [...r.childNodes]
    const content = (e: HTMLElement): string | null =>
      e.nodeType === 3 ? e.textContent : e.nodeType === 1 ? e.outerHTML : ''
    const key = (e: HTMLElement) =>
      (e.nodeType === 1 &&
        customElements.get(e.tagName.toLowerCase()) &&
        e.getAttribute('key')) ||
      NaN

    for (const a of r.attributes || [])
      if (l.getAttribute(a.name) !== a.value) {
        l.setAttribute(a.name, a.value)
        if (
          l.constructor.prototype.hasOwnProperty(a.name) &&
          typeof l[a.name] == 'boolean'
        )
          l[a.name] = true
        l.$update && l.$update()
      }
    for (const a of l.attributes || [])
      if (!r.hasAttribute(a.name)) {
        l.removeAttribute(a.name)
        if (
          l.constructor.prototype.hasOwnProperty(a.name) &&
          typeof l[a.name] == 'boolean'
        )
          l[a.name] = false
      }

    while (ls < le || rs < re)
      if (ls === le) {
        const val = rc[rs]
        l.insertBefore(lc.find((l) => key(l) == key(val)) || val, lc[ls]) &&
          rs++
      } else if (rs == re) l.removeChild(lc[ls++])
      else if (content(lc[ls]) === content(rc[rs])) {
        ls++
        rs++
      } else if (content(lc[le - 1]) === content(rc[re - 1])) {
        le--
        re--
      } else if (lc[ls] && rc[rs].children && lc[ls].tagName == rc[rs].tagName)
        El.morph(lc[ls++], rc[rs++])
      else lc[ls++].replaceWith(rc[rs++])
  }

  static nextTick(f?: Function) {
    return new Promise<void>((r) =>
      setTimeout((_) =>
        requestAnimationFrame((_) => {
          f?.()
          r()
        })
      )
    )
  }

  static zcss(...args: any[]) {
    let lines: any[] = []
    let stack: any[] = []
    let open: any
    let opened: any
    let close: any
    const src = args.join('').replace(/,\n/gs, ',')
    for (let line of src.split(/\n/)) {
      line = line.replace(/(.+,.+){/, ':is($1){')
      if (line.match(/^\s*@[msdk].*\{/))
        opened =
          open =
          close =
            (opened && !lines.push('}')) || lines.push(line) & 0
      else if (line.match(/\{\s*$/))
        open = stack.push(line.replace('{', '').trim()) | 1
      else if (line.match(/\s*\}\s*$/))
        close = (!stack.pop() && lines.push('}')) as any | 1
      else {
        if (!line.trim()) continue
        if (opened && (open || close)) opened = close = lines.push('}') & 0
        if (open || close)
          opened = !(open =
            lines.push((stack as any).join` `.replace(/ &/g, '') + '{') & 0)
        lines.push(line)
      }
    }
    return close && lines.push('}') && lines.join('\n')
  }
  static escape(v: any) {
    return v instanceof El.Raw
      ? v
      : v === 0
      ? v
      : String(v || '').replace(/[<>'"]/g, (c) => `&#${c.charCodeAt(0)}`)
  }
}
