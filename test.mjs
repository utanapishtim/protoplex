import { once } from 'events'
import SecretStream from '@hyperswarm/secret-stream'
import Protomux from 'protomux'
import Protoplex from './index.js'
import { pipeline, Duplex } from 'streamx'
import test from 'brittle'
import c from 'compact-encoding'
import struct from 'compact-encoding-struct'

test('emits "open"', async (t) => {
  t.plan(2)
  const { plexers: { server, client } } = testenv()
  const sopen = once(server, 'open')
  const copen = once(client, 'open')
  t.ok(await sopen)
  t.ok(await copen)
})

test('emits "destroy" no connections', async (t) => {
  t.plan(1)
  const { plexers: { server } } = testenv()
  await once(server, 'open')
  const destroyed = once(server, 'close')
  server.close()
  const [protocol] = await destroyed
  t.is(protocol, Protoplex.PROTOCOLS.CTL)
})

test('emits "destroy" with connections', async (t) => {
  t.plan(1)
  const { plexers: { server, client } } = testenv()
  const destroyed = once(server, 'close')
  server.on('connection', async (stream, id) => server.close())
  client.connect()
  await destroyed
  t.ok(true)
})

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

test('(client -> server) it should send and recv messages write-before-connect', async (t) => {
  t.plan(3)
  const { plexers: { server, client }, pipeline: p } = testenv({ pipe: (...args) => () => pipeline(...args) })
  const message = 'Hello, World!'
  server.on('connection', async (stream, id) => {
    console.log('connection')
    t.ok(stream instanceof Duplex)
    t.ok(Buffer.isBuffer(id))
    let str = ''
    for await (const buf of stream) str += buf.toString()
    t.is(str, message)
  })
  const stream = client.connect()
  stream.write(Buffer.from(message))
  stream.end()
  p()
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
    chan: { encoding: struct.compile({ greeting: c.string }) }
  })

  const message = { greeting: 'Hello, World!' }
  server.on('connection', async (stream, id) => {
    for await (const msg of stream) t.is(msg.greeting, message.greeting)
  })

  const stream = client.connect()
  stream.write(message)
  stream.end()
})

test('it should support resolving custom channel encoding from id', async (t) => {
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
    chan: {
      encoding: (_, id, handshake) => {
        t.ok(Buffer.isBuffer(id))
        t.ok(Buffer.isBuffer(handshake))
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

test('it should support resolving custom channel encoding from handshake', async (t) => {
  t.plan(9)

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
    chan: {
      encoding: (isInitiator, id, handshake) => {
        if (Buffer.compare(id, ids.fst) === 0) {
          if (!isInitiator) {
            t.ok(!Buffer.compare(ids.fst, handshake))
          } else {
            t.ok(!Buffer.compare(Buffer.from([]), handshake))
          }
          return struct.compile({ fst: c.string })
        } else if (Buffer.compare(id, ids.snd) === 0) {
          if (!isInitiator) {
            t.ok(!Buffer.compare(ids.snd, handshake))
          } else {
            t.ok(!Buffer.compare(Buffer.from([]), handshake))
          }
          return struct.compile({ snd: c.string })
        } else {
          if (!isInitiator) {
            t.ok(!Buffer.compare(Buffer.from(string), handshake))
          } else {
            t.ok(!Buffer.compare(Buffer.from([]), handshake))
          }
          return c.raw
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
    const fst = client.connect(ids.fst, { handshake: ids.fst })
    fst.write(msgs.fst)
    fst.end()
  })

  setImmediate(() => {
    const snd = client.connect(ids.snd, { handshake: ids.snd })
    snd.write(msgs.snd)
    snd.end()
  })

  setImmediate(() => {
    const thd = client.connect({ handshake: Buffer.from(string) })
    thd.write(Buffer.from(string))
    thd.end()
  })
})

function testenv ({ onend = noop, ctl, chan, pipe = pipeline } = {}) {
  const streams = {
    server: new SecretStream(false),
    client: new SecretStream(true)
  }
  const muxers = {
    server: new Protomux(streams.server),
    client: new Protomux(streams.client)
  }
  const plexers = {
    server: new Protoplex(muxers.server, { ctl, chan, id: 'server' }),
    client: new Protoplex(muxers.client, { ctl, chan, id: 'client' })
  }

  const pline = pipe(
    plexers.client.mux.stream.rawStream,
    plexers.server.mux.stream.rawStream,
    plexers.client.mux.stream.rawStream,
    onend
  )

  return { streams, muxers, plexers, pipeline: pline }
}

function noop () {}
