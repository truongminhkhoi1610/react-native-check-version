const express = require('express')
const semver = require('semver')
const axios = require('axios')
const lru = require('lru-cache')

const app = express()
const port = process.env.PORT || 80
const cache = lru({max: 2400, maxAge: 43200e3}) // 12 hours cache

const lookupVersion = async (platform, bundleId) => {
  const key = `${platform}.${bundleId}`
  let res = cache.get(key)
  if (res) {
    return res
  }

  let url
  switch (platform) {
    case 'ios':
      url = `http://itunes.apple.com/lookup?lang=en&bundleId=${bundleId}`
      res = await axios.get(url)
      if (!res.data || !('results' in res.data)) {
        throw new Error('Unknown error connecting to iTunes.')
      }
      if (!res.data.results.length) {
        throw new Error('App for this bundle ID not found.')
      }
      res = res.data.results[0]

      res = {
        version: res.version || null,
        released: res.currentVersionReleaseDate || res.releaseDate || null,
        notes: res.releaseNotes || '',
        url: res.trackViewUrl || res.artistViewUrl || res.sellerUrl || null
      }

      cache.set(key, res)
      return res
    case 'android':
      url = `https://play.google.com/store/apps/details?id=${bundleId}&hl=en`
      try {
        res = await axios.get(url)
      } catch(e) {
        if (e.response && e.response.status && e.response.status === 404) {
          throw new Error(`App with bundle ID "${bundleId}" not found in Google Play.`)
        }
        throw e
      }

      res = res.data

      let startToken = 'Current Version'
      let endToken = 'Requires'
      let indexStart = res.indexOf(startToken)
      res = res.substr(indexStart + startToken.length)
      let indexEnd = res.indexOf(endToken)
      res = res.substr(0, indexEnd).replace(/<[^>]+>/g, '').trim()

      res = {
        version: res || null,
        released: new Date(),
        notes: '',
        url: `https://play.google.com/store/apps/details?id=${bundleId}`
      }

      cache.set(key, res)
      return res
    default:
      throw new Error('Unsupported platform defined.')
  }
}

app.get('/', (req, res) => res.send('hi!'))
app.get('/health', (req, res) => res.send('hi!'))
app.get('/ping', (req, res) => res.send('hi!'))

app.get('/redirect/:platform/:bundleId', async (req, res) => {
  try {
    const data = await lookupVersion(req.params.platform, req.params.bundleId)
    res.redirect(data.url)
  } catch (e) {
    res.json({error: e.message || e})
  }
})

app.get('/:platform/:bundleId', async (req, res) => {
  try {
    const data = await lookupVersion(req.params.platform, req.params.bundleId)
    res.json(Object.assign({}, req.params, data))
  } catch (e) {
    res.json({error: e.message || e})
  }
})

app.get('/:platform/:bundleId/:currentVersion', async (req, res) => {
  try {
    const data = await lookupVersion(req.params.platform, req.params.bundleId)

    const needsUpdate = semver.lt(req.params.currentVersion, data.version)
    const updateType = needsUpdate ? semver.diff(req.params.currentVersion, data.version) : null
    res.json(Object.assign({}, req.params, data, {needsUpdate, updateType}))
  } catch (e) {
    res.json({error: e.message || e})
  }
})

app.get('/recent', async (req, res) => {
  res.json(cache.keys())
})

app.listen(port, () => console.log(`Version service listening on port ${port}`))
