const { EventEmitter, once, on } = require('events')
const Protomux = require('protomux')
const { Duplex, Readable } = require('streamx')
const c = require('compact-encoding')
const struct = require('compact-encoding-struct')
const crypto = require('hypercore-crypto')
const assert = require('nanoassert')

const EMPTY_BUFFER = Buffer.from([])
const PROTOCOLS = { CTL: 'protoplex/ctl', CHAN: 'protoplex/channel' }

module.exports = class Protoplex extends EventEmitter {
  mux = null
  ctl = null
  open = null

  destroying = null

  static get PROTOCOLS () { return PROTOCOLS }

  static from (mors, options) {
    const mux = (mors instanceof Protomux) ? mors : new Protomux(mors)
    return new Protoplex(mux, options)
  }

  constructor (mux, options = {}) {
    super()

    const plex = this
    const { ctl = {}, channel = {} } = options

    this.mux = mux
    this.options = options

    this.ctl = this.mux.createChannel({
      protocol: PROTOCOLS.CTL,
      id: ctl.id || null,
      handshake: ctl.handshakeEncoding || c.raw,
      onopen (handshake) { setImmediate(() => plex.emit('open', handshake)) },
      ondestroy () { setImmediate(() => plex.emit('destroy', PROTOCOLS.CTL, ctl.id || EMPTY_BUFFER)) }
    })

    this.open = this.ctl.addMessage({
      encoding: struct.compile({ isInitiator: c.bool, id: c.raw }),
      onmessage ({ isInitiator, id }) {
        if (!isInitiator) return plex.emit(id.toString('hex'))

        let bytes = null
        let onresume = null
        let destroyed = null

        const chan = mux.createChannel({
          protocol: PROTOCOLS.CHAN,
          id,
          handshake: channel.handshakeEncoding || c.raw,
          onopen (handshake) {
            const encoding = (typeof channel.encoding === 'function')
              ? (channel.encoding(false, id, handshake) || c.raw)
              : (channel.encoding || c.raw)

            const bytes = chan.addMessage({
              encoding,
              onmessage (buf) {
                if (stream.push(buf) === true) return
                if (onresume) return
                onresume = () => chan.uncork()
                chan.cork()
                backoff()
              }
            })
            plex.emit('connection', stream, id, handshake)
          },
          ondestroy () {
            if (destroyed) return
            destroyed = true
            stream.push(null)
            stream.end()
          }
        })

        const stream = new Duplex({
          write (buf, cb) {
            if (bytes.send(buf) === true) return cb(null)
            mux.stream.once('drain', cb)
          },
          final (cb) {
            if (destroyed) return cb(null)
            destroyed = true
            chan.close()
            return cb(null)
          }
        })

        stream.once('close', () => plex.emit('destroy', PROTOCOLS.CHAN, id))

        plex.open.send({ isInitiator: false, id })

        chan.open(channel.handshake || EMPTY_BUFFER)

        function backoff () {
          if (Readable.isBackpressured(stream)) return setImmediate(backoff)
          const cb = onresume
          onresume = null
          if (cb) return cb()
        }
      }
    })

    this.ctl.open(ctl.handshake || EMPTY_BUFFER)
  }

  connect (id = crypto.randomBytes(32), { handshake } = {}) {
    if (this.destroying) {
      const stream = new Duplex()
      stream.destroy()
      return stream
    }

    const plex = this
    const { options: { channel = {} } } = plex

    if (!Buffer.isBuffer(id)) {
      handshake = id.handshake
      id = crypto.randomBytes(32)
    }

    if (!handshake) handshake = (channel.handshake || EMPTY_BUFFER)

    let chan = null
    let bytes = null
    let onopen = null
    let onresume = null
    let destroyed = null

    const stream = new Duplex({
      open (cb) { onopen = cb },
      write (buf, cb) {
        if (bytes.send(buf) === true) return cb(null)
        plex.mux.stream.once('drain', cb)
      },
      final (cb) {
        if (destroyed) return cb(null)
        destroyed = true
        chan.close()
        return cb(null)
      }
    })

    stream.once('close', () => plex.emit('destroy', PROTOCOLS.CHAN, id))

    this.once(id.toString('hex'), () => {
      chan = this.mux.createChannel({
        protocol: PROTOCOLS.CHAN,
        id,
        handshake: channel.handshakeEncoding || c.raw,
        onopen (handshake) {
          const encoding = (typeof channel.encoding === 'function')
            ? (channel.encoding(true, id, handshake) || c.raw)
            : (channel.encoding || c.raw)

          bytes = chan.addMessage({
            encoding: encoding,
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
        },
        ondestroy () {
          if (destroyed) return
          destroyed = true
          stream.push(null)
          stream.end()
        }
      })

      chan.open(handshake)

      function backoff () {
        if (Readable.isBackpressured(stream)) return setImmediate(backoff)
        const cb = onresume
        onresume = null
        if (cb) return cb()
      }
    })

    this.open.send({ isInitiator: true, id })

    return stream
  }

  async _destroy () {
    console.log('_destroy')
    const purgatory = new Map()
    const ps = []

    this.on('destroy', function destroyer (protocol, id) {
      if (protocol !== PROTOCOLS.CHAN) return
      const key = id.toString('hex')
      const inverse = purgatory.get(key)
      inverse.resolve()
      purgatory.delete(key)
    })

    for (const channel of this.mux) {
      if (channel.protocol !== PROTOCOLS.CHAN) continue
      const { inverse, promise } = inversepromise()
      ps.push(promise)
      purgatory.set(channel.id.toString('hex'), inverse)
      channel.close()
    }

    this.ctl.close()

    await Promise.all(ps)

    this.ctl = null
    this.open = null

    return true
  }

  async destroy () {
    if (this.destroying) return this.destroying
    this.destroying = this._destroy()
    this.destroying.catch((e) => this.emit('error', e))
    return this.destroying
  }
}

function inversepromise () {
  const inverse = { resolve: null, reject: null }
  const promise = new Promise((resolve, reject) => Object.assign(inverse, { resolve, reject }))
  return { inverse, promise }
}
