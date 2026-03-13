## Summary

- **Test suite**: Set up Vitest with 38 tests covering agent routing, context building, completion checking, SMS parsing, message templates, and utility functions
- **CI/CD**: GitHub Actions pipeline that runs type-check, tests, and build on every push/PR to master
- **Security hardening**: Enforced Twilio webhook signature validation (HMAC-SHA1) and added payment webhook HMAC-SHA256 signature verification with API key-based org_id resolution
- **ElevenLabs voice widget**: Full WebSocket integration with real-time audio streaming, microphone capture, live transcript, and client-side tool handling
- **README**: Architecture overview, setup instructions, environment variable reference, and available scripts

## Test plan

- [x] All 38 tests pass (`pnpm test`)
- [ ] Verify Twilio webhook rejects requests with invalid signatures in staging
- [ ] Verify payment webhook resolves org_id from API key header
- [ ] Test ElevenLabs voice widget with a configured agent ID in the browser
- [ ] Confirm CI pipeline runs successfully on this PR
