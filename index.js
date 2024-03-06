const { EventEmitter } = require('events')
const Protomux = require('protomux')
const { Duplex } = require('streamx')
const c = require('compact-encoding')
const b4a = require('b4a')

const PROTOCOL = 'protoplex/alpha@0.0.0'

class ProtoplexStream extends Duplex {
  mux = null
  channel = null

  protocol = PROTOCOL
  id = b4a.from([])
  handshake = b4a.from([])
  handshakeEncoding = c.raw
  onhandshake = null
  encoding = c.array(c.raw)
  unique = false

  remoteHandshake = null

  _q = []
  _ondrain = null

  constructor (mux, opts = {}) {
    const {
      id,
      handshake,
      handshakeEncoding,
      onhandshake,
      encoding,
      unique,
      ...stream
    } = opts

    super({ ...stream, eagerOpen: true })

    if (!(mux instanceof Protomux)) throw new Error('mux not an instance of Protomux!')

    this.mux = mux
    this.id = id ?? this.id
    this.handshake = handshake ?? this.handshake
    this.handshakeEncoding = handshakeEncoding ?? this.handshakeEncoding
    this.onhandshake = onhandshake ?? this.onhandshake
    this.encoding = c.array(encoding) ?? this.encoding
    this.unique = unique ?? this.unique
  }

  _open (cb) {
    const {
      mux,
      protocol,
      id,
      handshake,
      handshakeEncoding,
      encoding,
      unique
    } = this

    let flag = false
    const _cb = (err) => {
      if (flag) return
      flag = true
      return cb(err)
    }

    this.channel = mux.createChannel({
      protocol,
      id,
      handshake: handshakeEncoding,
      unique,
      messages: [{ encoding, onmessage: this._onmessage.bind(this) }],
      onopen: (handshake) => this._onopen(handshake, _cb),
      onclose: () => {
        if (!this.opened) _cb(null)
        setTimeout(() => this.push(null), 0)
      },
      ondestroy: () => {
        if (!this.opened) _cb(null)
        setTimeout(() => this.destroy(), 0)
      },
      ondrain: () => {
        this._callondrain(null)
      }
    })

    this.channel.open(handshake)
  }

  _writev (data, cb) {
    try {
      if (this.channel.messages[0].send(data)) return cb(null)
      else this._ondrain = cb
    } catch (err) {
      return cb(err)
    }
  }

  _read (cb) {
    this.channel.uncork()
    while (this._q.length && this.push(this._q.pop())) continue
    if (this._q.length) this.channel.cork()
    return cb(null)
  }

  _final (cb) {
    setTimeout(() => this.channel.close(), 0)
    return cb(null)
  }

  _destroy (cb) {
    this.channel?.close()
    this.mux = null
    this.channel = null
    return cb(null)
  }

  _predestroy () {
    this.channel?.close()
    this._callondrain(new Error('Stream was destroyed'))
  }

  _callondrain (err) {
    const cb = this._ondrain
    this._ondrain = null
    if (cb) return cb(err)
  }

  _onmessage (msgs) {
    while (msgs.length && this.push(msgs.pop())) continue
    if (!msgs.length) return
    this._q = this._q.append(msgs)
    this.channel.cork()
  }

  async _onhandshake (handshake) {
    if (this.onhandshake) return this.onhandshake(handshake)
    else return true
  }

  async _onopen (handshake, cb) {
    try {
      const shouldConnect = await this._onhandshake(handshake)
      if (!shouldConnect) return cb(new Error('Connection Rejected!'))
      this.emit('connect')
      this.remoteHandshake = handshake
      return cb(null)
    } catch (err) {
      return cb(err)
    }
  }
}

exports.ProtoplexStream = ProtoplexStream

module.exports = class Protoplex extends EventEmitter {
  mux = null

  id = b4a.from([])
  handshake = b4a.from([])
  handshakeEncoding = c.raw
  encoding = c.raw
  unique = false
  streamOpts = {}

  _streams = new Set()
  _listeners = new Map()

  static from (muxOrStream, opts = {}) {
    const mux = (muxOrStream instanceof Protomux)
      ? muxOrStream
      : new Protomux(muxOrStream)
    return new Protoplex(mux, opts)
  }

  get protocol () { return PROTOCOL }

  constructor (mux, opts = {}) {
    const {
      id,
      handshake,
      handshakeEncoding,
      onhandshake,
      encoding,
      unique,
      ...streamOpts
    } = opts

    super()

    this.mux = mux
    this.id = id ?? this.id
    this.handshake = handshake ?? this.handshake
    this.handshakeEncoding = handshakeEncoding ?? this.handshakeEncoding
    this.onhandshake = onhandshake ?? this.onhandshake
    this.encoding = encoding ?? this.encoding
    this.unique = unique ?? this.unique
    this.streamOpts = streamOpts ?? this.streamOpts
  }

  listen (id, opts = {}) {
    if (!b4a.isBuffer(id)) {
      opts = id
      id = null
    }
    const { protocol, id: _id } = this
    id = id ?? _id
    if (this._listeners.has(id)) return this
    this._listeners.set(id, opts)
    this.mux.pair({ protocol, id }, this._onpair.bind(this))
    return this
  }

  unlisten (id) {
    const { protocol } = this
    if (!this._listeners.has(id)) return this
    this._listeners.delete(id)
    this.mux.unpair({ protocol, id })
    return this
  }

  connect (id, _opts = {}) {
    if (!b4a.isBuffer(id)) {
      _opts = id
      id = null
    }

    const {
      protocol,
      id: _id,
      handshake,
      handshakeEncoding,
      onhandshake,
      encoding,
      unique,
      streamOpts
    } = this

    id = id ?? _id

    const opts = {
      protocol,
      handshake,
      handshakeEncoding,
      onhandshake,
      encoding,
      unique,
      ...streamOpts,
      ..._opts,
      id
    }

    return new ProtoplexStream(this.mux, opts)
  }

  async _onpair (id) {
    const _opts = this._listeners.get(id) ?? {}

    const {
      protocol,
      id: _id,
      handshake,
      handshakeEncoding,
      onhandshake,
      encoding,
      unique,
      streamOpts
    } = this

    id = id ?? _id

    const opts = {
      protocol,
      handshake,
      handshakeEncoding,
      onhandshake,
      encoding,
      unique,
      ...streamOpts,
      ..._opts,
      id
    }

    const stream = new ProtoplexStream(this.mux, opts)
    this._streams.add(stream)
    stream.once('end', () => this._streams.delete(stream))

    this.emit('connection', stream)
  }

  [Symbol.iterator] () { return this._streams[Symbol.iterator]() }
}
