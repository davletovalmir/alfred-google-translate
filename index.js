"use strict"
var alfy = require("alfy")
var tts = require("./tts")
var translator = require("./translate")
var configstore = require("configstore")
var os = require("os")
var uuidv4 = require("uuid/v4")
var history = new configstore("translate-history")
var languages = require("./languages")
var SocksProxyAgent = require("socks-proxy-agent")

var g_config = {
  voice: process.env.voice || "remote",
  save: process.env.save_count || 20,
  domain: process.env.domain || "https://translate.google.com",
  agent: process.env.socks_proxy
    ? new SocksProxyAgent(process.env.socks_proxy)
    : undefined,
}

// Detect language and set translation pair accordingly
translator
  .translate(alfy.input, {
    from: "auto",
    to: "en", // Temporary target, actual target determined after detection
    domain: g_config.domain,
    client: "gtx",
    agent: g_config.agent,
  })
  .then(function (res) {
    var detect = res.from.language.iso
    var from, to

    if (detect === "en") {
      // If detected language is English, translate to Russian
      from = "en"
      to = "ru"
    } else {
      // If detected language is not English, translate to English
      from = detect
      to = "en"
    }

    doTranslate({
      text: alfy.input,
      from: {
        language: from,
        ttsfile: os.tmpdir() + "/" + uuidv4() + ".mp3",
      },
      to: {
        language: to,
        ttsfile: os.tmpdir() + "/" + uuidv4() + ".mp3",
      },
    })
  })

function doTranslate(opts) {
  //文档上说cmd+L时会找largetype，找不到会找arg，但是实际并不生效。
  //同时下一步的发音模块中query变量的值为arg的值。
  translator
    .translate(opts.text, {
      from: opts.from.language,
      to: opts.to.language,
      domain: g_config.domain,
      client: "gtx",
      agent: g_config.agent,
    })
    .then(function (res) {
      var items = []

      if ("auto" === opts.from.language || res.from.language.didYouMean) {
        // Detected the input language not in configuration
        items.push({
          title: res.to.text.value,
          subtitle: `Detected the input language is ${
            languages[res.from.language.iso]
          }, not one of your configuration.`,
        })
      } else if (res.from.corrected.corrected || res.from.corrected.didYouMean) {
        var corrected = res.from.corrected.value.replace(/\[/, "").replace(/\]/, "")

        // Correct
        items.push({
          title: res.to.text.value,
          subtitle: `Show translation for ${corrected}?`,
          autocomplete: corrected,
        })
      } else {
        var fromPhonetic = res.from.text.phonetic
        var fromText = res.from.text.value
        var fromArg =
          g_config.voice === "remote"
            ? opts.from.ttsfile
            : g_config.voice === "local"
            ? fromText
            : ""
        // Input
        items.push({
          title: fromText,
          subtitle: `${fromPhonetic}`,
          quicklookurl: `${g_config.domain}/#view=home&op=translate&sl=${
            opts.from.language
          }&tl=${opts.to.language}&text=${encodeURIComponent(fromText)}`,
          arg: fromArg,
          text: {
            copy: fromText,
            largetype: fromText,
          },
          icon: {
            path: g_config.voice === "none" ? "icon.png" : "tts.png",
          },
        })

        var toPhonetic = res.to.text.phonetic
        var toText = res.to.text.value
        var toArg =
          g_config.voice === "remote"
            ? opts.to.ttsfile
            : g_config.voice === "local"
            ? toText
            : ""

        // Translation
        items.push({
          title: toText,
          subtitle: `${toPhonetic}`,
          quicklookurl: `${g_config.domain}/#view=home&op=translate&sl=${
            opts.to.language
          }&tl=${opts.from.language}&text=${encodeURIComponent(toText)}`,
          arg: toArg,
          text: {
            copy: toText,
            largetype: toText,
          },
          icon: {
            path: g_config.voice === "none" ? "icon.png" : "tts.png",
          },
        })

        // Translation Of
        res.to.translations.forEach((translation) => {
          items.push({
            title: translation.value,
            subtitle: translation.synonyms.join(", "),
            text: {
              copy: translation.value,
              largetype: `Translation: ${translation.value}\n\nSynonyms: ${translation.synonyms}`,
            },
          })
        })
      }

      alfy.output(items)

      res.from.language.ttsfile = opts.from.ttsfile
      res.to.language = { iso: opts.to.language, ttsfile: opts.to.ttsfile }
      return res
    })
    .then((res) => {
      // history, todo: could be optimized
      if (g_config.save > 0) {
        var value = {
          time: Date.now(),
          from: res.from.text.value,
          to: res.to.text.value,
        }
        var histories = history.get("history") ? JSON.parse(history.get("history")) : []
        if (histories.length >= g_config.save) histories.shift()
        histories.push(value)
        history.set("history", JSON.stringify(histories))
      }

      return res
    })
    .then((res) => {
      // tts
      if (g_config.voice === "remote") {
        var fromArray = []
        res.from.text.array.forEach((o) => tts.split(o).forEach((t) => fromArray.push(t)))
        tts.multi(fromArray, {
          to: res.from.language.iso,
          domain: g_config.domain,
          file: res.from.language.ttsfile,
          client: "gtx",
          agent: g_config.agent,
        })
        var toArray = []
        res.to.text.array.forEach((o) => tts.split(o).forEach((t) => toArray.push(t)))
        tts.multi(toArray, {
          to: res.to.language.iso,
          domain: g_config.domain,
          file: res.to.language.ttsfile,
          client: "gtx",
          agent: g_config.agent,
        })
      }
    })
}
