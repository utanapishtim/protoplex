const { EventEmitter } = require('events')
const Protomux = require('protomux')
const { Readable, Duplex } = require('streamx')
const c = require('compact-encoding')
const struct = require('compact-encoding-struct')
const crypto = require('hypercore-crypto')

const PROTOCOLS = { CTL: 'protoplex/ctl', CHAN: 'protoplex/chan' }
const EMPTY_BUFFER = Buffer.from([])

module.exports = class Protoplex extends EventEmitter {
  mux = null
  ctl = null
  open = null

  opened = false
  closed = false

  closing = null

  static PROTOCOLS = PROTOCOLS

  static from (mors, options) {
    const mux = (mors instanceof Protomux) ? mors : new Protomux(mors)
    return new Protoplex(mux, options)
  }

  constructor (mux, options = {}) {
    super()

    const { ctl = {}, chan = {} } = options

    ctl.handshake = (ctl.handshake ?? EMPTY_BUFFER)
    ctl.handshakeEncoding = (ctl.handshakeEncoding ?? c.raw)
    chan.handshake = (chan.handshake ?? EMPTY_BUFFER)
    chan.handshakeEncoding = (chan.handshakeEncoding ?? c.raw)
    chan.encoding = (chan.encoding ?? c.raw)

    this.mux = mux
    this.options = { ctl, chan }

    this.ctl = this.mux.createChannel({
      protocol: PROTOCOLS.CTL,
      id: ctl.id,
      handshake: c.raw,
      onopen: (handshake) => {
        this.opened = true
        this.emit('open', handshake)
      },
      ondestroy: () => {
        this.closed = true
        this.emit('close', PROTOCOLS.CTL, ctl.id)
      }
    })

    this.open = this.ctl.addMessage({
      encoding: struct.compile({ isInitiator: c.bool, id: c.raw }),
      onmessage: onmessage.bind(this)
    })

    this.ctl.open(ctl.handshake)
  }

  connect (id = crypto.randomBytes(32), { handshake } = {}) {
    if (this.closing) {
      const stream = new Duplex()
      stream.push(null)
      stream.end()
      return stream
    }

    if (!Buffer.isBuffer(id)) {
      handshake = id.handshake
      id = crypto.randomBytes(32)
    }

    handshake = (handshake ?? this.options.chan.handshake)

    let chan = null
    let bytes = null

    let onopen = null
    let onresume = null
    let destroyed = null

    const stream = new Duplex({
      eagerOpen: true,
      open (cb) {
        onopen = () => {
          stream.resume()
          return cb(null)
        }
      },
      write: (buf, cb) => {
        if (bytes.send(buf) === true) return cb(null)
        this.mux.stream.once('drain', cb)
      },
      final (cb) {
        if (destroyed) return cb(null)
        destroyed = true
        chan.close()
        return cb(null)
      }
    })

    stream.once('close', () => this.emit('destroy', PROTOCOLS.CHAN, id))

    this.once(id.toString('hex'), onack.bind(this))
    this.open.send({ isInitiator: true, id })

    return stream

    function onack () {
      chan = this.mux.createChannel({
        protocol: PROTOCOLS.CHAN,
        id,
        handshake: this.options.chan.handshakeEncoding,
        onopen: onchanopen.bind(this),
        ondestroy () {
          if (destroyed) return
          destroyed = true
          if (stream) {
            stream.push(null)
            stream.end()
          }
        }
      })

      chan.open(handshake)

      function onchanopen (handshake) {
        const encoding = (typeof this.options.chan.encoding === 'function')
          ? (this.options.chan.encoding(true, id, handshake) || c.raw)
          : (this.options.chan.encoding || c.raw)

        bytes = chan.addMessage({
          encoding,
          onmessage (buf) {
            if (stream.push(buf) === true) return
            if (onresume) return
            onresume = () => chan.uncork()
            chan.cork()
            backoff()
          }
        })

        const cb = onopen
        onopen = null
        if (cb) cb(null)

        function backoff () {
          if (Readable.isBackpressured(stream)) return setImmediate(backoff)
          const cb = onresume
          onresume = null
          if (cb) return cb()
        }
      }
    }
  }

  async _close () {
    const purgatory = new Map()
    const promises = []

    this.on('destroy', destroyer)

    for (const chan of this.mux) {
      if (chan.protocol !== PROTOCOLS.CHAN) continue
      const p = { resolve: null, reject: null }
      promises.push(new Promise((resolve, reject) => Object.assign(p, { resolve, reject })))
      purgatory.set(chan.id.toString('hex'), p)
      chan.close()
    }

    await Promise.all(promises)
    this.removeListener('destroy', destroyer)
    await new Promise((resolve) => {
      const ondestroy = (proto) => { if (proto === PROTOCOLS.CTL) resolve() }
      this.once('destroy', ondestroy)
      this.ctl.close()
    })

    this.ctl = null
    this.open = null

    return true

    function destroyer (protocol, id) {
      if (protocol !== PROTOCOLS.CHAN) return
      const key = id.toString('hex')
      purgatory.get(key).resolve()
      purgatory.delete(key)
    }
  }

  close () {
    if (this.closing) return this.closing
    this.closing = this._close()
    return this.closing
  }
}

function onmessage ({ isInitiator, id }) {
  if (!isInitiator) return this.emit(id.toString('hex'))

  let bytes = null
  let stream = null
  let onresume = null
  let destroyed = null

  const chan = this.mux.createChannel({
    protocol: PROTOCOLS.CHAN,
    id,
    handshake: this.options.chan.handshakeEncoding,
    onopen: onopen.bind(this),
    ondestroy: () => {
      if (destroyed) return
      destroyed = true
      if (stream) {
        stream.push(null)
        stream.end()
      }
    }
  })

  this.open.send({ isInitiator: false, id })
  chan.open(this.options.chan.handshake)

  function onopen (handshake) {
    const encoding = (typeof this.options.chan.encoding === 'function')
      ? (this.options.chan.encoding(false, id, handshake) || c.raw)
      : (this.options.chan.encoding || c.raw)

    bytes = chan.addMessage({
      encoding,
      onmessage (buf) {
        if (stream.push(buf) === true) return
        if (onresume) return
        onresume = () => chan.uncork()
        chan.cork()
        backoff()
      }
    })

    stream = new Duplex({
      write: (buf, cb) => {
        if (bytes.send(buf) === true) return cb(null)
        this.mux.stream.once('drain', cb)
      },
      final (cb) {
        if (destroyed) return cb(null)
        destroyed = true
        chan.close()
        return cb(null)
      }
    })

    stream.once('close', () => this.emit('destroy', PROTOCOLS.CHAN, id))

    this.emit('connection', stream, id, handshake)

    function backoff () {
      if (Readable.isBackpressured(stream)) return setImmediate(backoff)
      const cb = onresume
      onresume = null
      if (cb) return cb()
    }
  }
}
