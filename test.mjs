import SecretStream from '@hyperswarm/secret-stream'
import Protomux from 'protomux'
import Protoplex from './index.js'
import { pipeline, Duplex } from 'streamx'
import test from 'brittle'
import c from 'compact-encoding'
import struct from 'compact-encoding-struct'

test('(client -> server) it should send and recv messages', async (t) => {
  t.plan(3)
  const { plexers: { server, client } } = testenv()
  const message = 'Hello, World!'
  server.on('connection', async (stream, id) => {
    t.ok(stream instanceof Duplex)
    t.ok(Buffer.isBuffer(id))
    let str = ''
    for await (const buf of stream) str += buf.toString()
    t.is(str, message)
  })
  const stream = client.connect()
  stream.write(Buffer.from(message))
  stream.end()
})

test('(client <- server) it should send and recv messages', async (t) => {
  t.plan(3)
  const { plexers: { server, client } } = testenv()
  const message = 'Hello, World!'
  client.on('connection', async (stream, id) => {
    t.ok(stream instanceof Duplex)
    t.ok(Buffer.isBuffer(id))
    let str = ''
    for await (const buf of stream) str += buf.toString()
    t.is(str, message)
  })
  const stream = server.connect()
  stream.write(Buffer.from(message))
  stream.end()
})

test('it should send and recv messages from many clients', async (t) => {
  const count = Math.floor(Math.random() * ((Math.floor(Math.random() * 10)) * 10)) || 1
  t.plan(count)

  const { plexers: { server, client } } = testenv()
  const message = 'Hello, World!'

  server.on('connection', async (stream, id) => {
    let str = ''
    for await (const buf of stream) str += buf.toString()
    t.is(str, message)
  })

  for (let i = 0; i < count; i++) {
    const stream = client.connect()
    stream.write(Buffer.from(message))
    stream.end()
  }
})

test('it should support passing custom channel encoding', async (t) => {
  t.plan(1)

  const { plexers: { server, client } } = testenv({
    channel: { encoding: struct.compile({ greeting: c.string }) }
  })

  const message = { greeting: 'Hello, World!' }
  server.on('connection', async (stream, id) => {
    for await (const msg of stream) t.is(msg.greeting, message.greeting)
  })

  const stream = client.connect()
  stream.write(message)
  stream.end()
})

test('it should support resolving custom channel encoding from id and handshake', async (t) => {
  t.plan(15)

  const ids = {
    fst: Buffer.from('fst'),
    snd: Buffer.from('snd')
  }

  const msgs = {
    fst: { fst: 'fst' },
    snd: { snd: 'snd' }
  }

  const string = 'string'

  const { plexers: { server, client } } = testenv({
    channel: {
      encoding: (id, handshake) => {
        t.ok(Buffer.isBuffer(id))
        t.ok(!handshake)
        if (Buffer.compare(id, ids.fst) === 0) {
          return struct.compile({ fst: c.string })
        } else if (Buffer.compare(id, ids.snd) === 0) {
          return struct.compile({ snd: c.string })
        }
      }
    }
  })

  server.on('connection', async (stream, id) => {
    for await (const msg of stream) {
      if (Buffer.compare(id, ids.fst) === 0) {
        t.is(msg.fst, msgs.fst.fst)
      } else if (Buffer.compare(id, ids.snd) === 0) {
        t.is(msg.snd, msgs.snd.snd)
      } else {
        t.is(msg.toString('utf8'), string)
      }
    }
  })

  setImmediate(() => {
    const fst = client.connect(ids.fst)
    fst.write(msgs.fst)
    fst.end()
  })

  setImmediate(() => {
    const snd = client.connect(ids.snd)
    snd.write(msgs.snd)
    snd.end()
  })

  setImmediate(() => {
    const thd = client.connect()
    thd.write(Buffer.from(string, 'utf8'))
    thd.end()
  })
})

function testenv ({ onend = noop, ctl, channel } = {}) {
  const streams = {
    server: new SecretStream(false),
    client: new SecretStream(true)
  }
  const muxers = {
    server: new Protomux(streams.server),
    client: new Protomux(streams.client)
  }
  const plexers = {
    server: new Protoplex(muxers.server, { ctl, channel }),
    client: new Protoplex(muxers.client, { ctl, channel })
  }

  pipeline(
    plexers.server.mux.stream.rawStream,
    plexers.client.mux.stream.rawStream,
    plexers.server.mux.stream.rawStream,
    onend
  )

  return { streams, muxers, plexers }
}

function noop () {}
