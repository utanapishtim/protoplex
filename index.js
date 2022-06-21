const { EventEmitter } = require('events')
const Protomux = require('protomux')
const { Duplex, Readable } = require('streamx')
const c = require('compact-encoding')
const struct = require('compact-encoding-struct')
const crypto = require('hypercore-crypto')

module.exports = class Protoplex extends EventEmitter {
  mux = null
  ctl = null
  open = null

  static from (mors, opts) {
    const mux = (morst instanceof Protomux) ? mors : new Protomux(mors)
    return new Protoplex(mux, opts)
  }

  constructor (mux, { ctl, channel } = {}) {
    super()

    const plex = this

    this.mux = mux

    this.options = { ctl, channel }

    this.ctl = this.mux.createChannel({
      protocol: 'protoplex/ctl',
      id: ctl?.id ?? null,
      handshake: ctl?.handshakeEncoding ?? null,
      async onopen (handshake) { plex.emit('open', handshake) },
      onclose () { plex.emit('close') },
      ondestroy () { plex.emit('destroy') }
    })

    this.open = this.ctl.addMessage({
      encoding: struct.compile({ isInitiator: c.bool, id: c.raw }),
      onmessage ({ isInitiator, id }) {
        if (!isInitiator) return plex.emit(id.toString('hex'))

        let bytes = null
        let onresume = null
        let destroyed = null

        const chan = mux.createChannel({
          protocol: 'protoplex/chan',
          id,
          handshake: channel?.handshakeEncoding ?? null,
          onopen (handshake) {
            let _encoding = c.raw
            const encoding = channel?.encoding
            _encoding = (typeof encoding === 'function')
              ? (encoding(id, handshake) ?? _encoding)
              : (encoding ?? _encoding)

            const bytes = chan.addMessage({
              encoding: _encoding,
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

        stream.once('error', () => chan.close())

        plex.open.send({ isInitiator: false, id })

        if (channel?.handshake) chan.open(channel.handshake)
        else chan.open()

        function backoff () {
          if (Readable.isBackpressured(stream)) return setImmediate(backoff)
          const cb = onresume
          onresume = null
          if (cb) return cb()
        }
      }
    })

    if (ctl?.handshake) this.ctl.open(ctl.handshake)
    else this.ctl.open()
  }

  connect (id = crypto.randomBytes(32), { handshake } = {}) {
    const plex = this
    const { options: { channel } } = plex
    if (!Buffer.isBuffer(id)) handshake = id?.handshake
    if (!handshake) handshake = channel?.handshake

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

    stream.once('error', () => chan.close())

    this.once(id.toString('hex'), () => {
      chan = this.mux.createChannel({
        protocol: 'protoplex/chan',
        id,
        handshake: channel?.handshakeEncoding ?? null,
        onopen (handshake) {
          let _encoding = c.raw
          const encoding = channel?.encoding
          _encoding = (typeof encoding === 'function')
            ? (encoding(id, handshake) ?? _encoding)
            : (encoding ?? _encoding)

          bytes = chan.addMessage({
            encoding: _encoding,
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
          stream.end()
          stream.push(null)
        }
      })

      if (handshake) chan.open(handshake)
      else chan.open()

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
}
