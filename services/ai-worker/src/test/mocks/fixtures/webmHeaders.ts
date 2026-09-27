/**
 * WebM (EBML) header-prefix fixtures for the container sniff tests. Each is
 * the first bytes of a real file, from offset 0 through the first Cluster
 * element id (`1F 43 B6 75`), embedded as hex so the repo carries no binary
 * fixture files.
 */

/** Decode a hex string into bytes. */
export function hexToBytes(hex: string): Uint8Array {
  return Uint8Array.from(Buffer.from(hex, 'hex'));
}

/** Decode a hex string into a standalone ArrayBuffer (the shape `fetchAudioBuffer` resolves). */
export function hexToArrayBuffer(hex: string): ArrayBuffer {
  const bytes = hexToBytes(hex);
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

/**
 * Chromium MediaRecorder `audio/webm;codecs=opus` recording (headless Chrome
 * 154): unknown-size Segment, one CodecID `86 86 "A_OPUS"`, first Cluster at
 * byte 146.
 */
export const CHROMIUM_AUDIO_WEBM_PREFIX_HEX =
  '1a45dfa39f4286810142f7810142f2810442f381084282847765626d42878104428581021853806701ffffffffffffff1549a966992ad7b1830f42404d80864368726f6d655741864368726f6d651654ae6bbfaebdd7810173c5879ad32b934aa5028381028686415f4f50555363a2934f707573486561640102000080bb0000000000e18db584473b80009f8102626481201f43b675';

/**
 * ffmpeg A/V WebM, `ffmpeg -f lavfi -i testsrc=size=16x16:rate=5 -f lavfi -i
 * anullsrc=r=48000:cl=mono -t 0.3 -c:v libvpx -c:a libopus av.webm`: CodecID
 * `86 85 "V_VP8"` at 304 and `86 86 "A_OPUS"` at 376, first Cluster at 660.
 */
export const FFMPEG_AV_WEBM_PREFIX_HEX =
  '1a45dfa39f4286810142f7810142f2810442f381084282847765626d42878104428581021853806701000000000004d5114d9b74ba4dbb8b53ab841549a96653ac81a14dbb8b53ab841654ae6b53ac81d64dbb8c53ab841254c36753ac8201894dbb8c53ab841c53bb6b53ac8204bfec010000000000005900000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000001549a966b02ad7b1830f42404d808c4c61766636312e372e31303057418c4c61766636312e372e31303044898840790000000000001654ae6b40adae010000000000003fd7810173c5884caaeaef8fada51d9c810022b59c83756e648881008685565f56503883810123e383840bebc200e090b08110ba81109a810255b08455b98101ae010000000000005cd7810273c5888459faff97f1f0b89c810022b59c83756e648881008686415f4f50555356aa83632ea056bb8404c4b400838102e1919f8101b58840e77000000000006264811063a2934f707573486561640101380180bb00000000001254c36740d573739f63c08067c89945a387454e434f44455244878c4c61766636312e372e3130307373d663c08b63c5884caaeaef8fada51d67c8a145a387454e434f4445524487944c61766336312e31392e313031206c696276707867c8a145a3884455524154494f4e44879330303a30303a30302e343030303030303030007373d763c08b63c5888459faff97f1f0b867c8a245a387454e434f4445524487954c61766336312e31392e313031206c69626f70757367c8a145a3884455524154494f4e44879330303a30303a30302e333038303030303030001f43b675';

/**
 * Synthetic, the Chromium audio prefix followed, strictly past the Cluster
 * id, by a `86 85 "V_VP8"` CodecID; pins the scan's Cluster bound.
 */
export const VIDEO_CODEC_AFTER_CLUSTER_HEX =
  `${CHROMIUM_AUDIO_WEBM_PREFIX_HEX}e78100` + `8685565f565038` + `a38100`;

/**
 * Synthetic, ASCII `V_VP8` inside a Name element (`53 6E 85`) before the
 * Cluster, with only `86 86 "A_OPUS"` as a CodecID; pins the `0x86`
 * element-id requirement.
 */
export const BARE_V_PREFIX_BEFORE_CLUSTER_HEX =
  '1a45dfa3' + '536e85565f565038' + '8686415f4f505553' + '1f43b675' + 'e78100';
