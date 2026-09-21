/**
 * Capture of `message.embeds[0]` from a production vxReddit link unfurl,
 * with the poster's identifiers replaced by placeholders of the same shape.
 * `message.components` was empty on that message. The `components` key on
 * an embed is undocumented by Discord and untyped in discord-api-types at
 * the installed version, which is why every reader of this shape guards
 * over `unknown` rather than trusting a declared type.
 */
export const VXREDDIT_COMPONENTS_V2_EMBED = {
  type: 'components',
  url: 'https://www.vxreddit.com/r/Cult_of_Emily/s/exampleslug',
  content_scan_version: 0,
  components: [
    {
      type: 17,
      id: 1,
      accent_color: 16729344,
      components: [
        { type: 10, id: 2, content: '-# vxReddit' },
        {
          type: 10,
          id: 3,
          content:
            '** u/example_user on r/Cult_of_Emily - ⬆️ 691 | 💬 14 [(link)](https://www.reddit.com/comments/abc1234) **',
        },
        { type: 10, id: 4, content: "## Emily's trying something new for an outfit" },
        {
          type: 12,
          id: 5,
          items: [
            {
              media: {
                id: '1234567890123456789',
                url: 'https://i.redd.it/exampleimg01.jpeg',
                proxy_url:
                  'https://images-ext-1.discordapp.net/external/examplehash0000000000000000000000000000000/https/i.redd.it/exampleimg01.jpeg',
                width: 1080,
                height: 785,
                placeholder: 'zPcRDYAGiJh7hYeDekeYhviGfAc4',
                placeholder_version: 1,
                content_type: 'image/jpeg',
                loading_state: 1,
                flags: 0,
              },
              description: null,
              spoiler: false,
            },
          ],
        },
      ],
      spoiler: false,
    },
  ],
} as const;
