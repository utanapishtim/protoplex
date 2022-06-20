import { EventEmitter } from 'events'
import Protomux from 'protomux'
import { Duplex, Readable } from 'streamx'
import c from 'compact-encoding'
import struct from 'compact-encoding-struct'
import crypto from 'hypercore-crypto'

export default class Protoplex extends EventEmitter {
  mux = null
  ctl = null
  open = null

  static from (mors) {
    if (mors instanceof Protomux) return new Protoplex(mors)
    return new Protoplex(new Protomux(mors))
  }

  constructor (mux) {
    super()

    const plex = this

    this.mux = mux
    this.ctl = this.mux.createChannel({ protocol: 'protoplex/ctl' })
    this.open = this.ctl.addMessage({
      encoding: struct.compile({ isInitiator: c.bool, id: c.raw }),
      onmessage ({ isInitiator, id }) {
        if (!isInitiator) return plex.emit(id.toString('hex'))

        let onresume = null
        let destroyed = null

        const chan = mux.createChannel({
          protocol: 'protoplex/chan',
          id,
          onopen () { plex.emit('connection', stream, id) },
          ondestroy () {
            if (destroyed) return
            destroyed = true
            stream.push(null)
            stream.end()
          }
        })

        const bytes = chan.addMessage({
          encoding: c.raw,
          onmessage (buf) {
            if (stream.push(buf) === true) return
            if (onresume) return
            onresume = () => chan.uncork()
            chan.cork()
            backoff()
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
        chan.open()

        function backoff () {
          if (Readable.isBackpressured(stream)) return setImmediate(backoff)
          const cb = onresume
          onresume = null
          if (cb) return cb()
        }
      }
    })

    this.ctl.open()
  }

  connect (id = crypto.randomBytes(32)) {
    const plex = this

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
        onopen () {
          bytes = chan.addMessage({
            encoding: c.raw,
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

      chan.open()

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
