from redis.asyncio import Redis
from redis.exceptions import RedisError

from essence.reading.ai import AIUnavailable

# Atomic fixed-window counter. Expiry bounds memory and survives abandoned requests.
SCRIPT = """
local n = redis.call('INCR', KEYS[1])
if n == 1 then redis.call('EXPIRE', KEYS[1], 60) end
return n
"""


class ProviderLimiter:
    def __init__(self, redis: Redis):
        self.redis = redis

    async def acquire(self) -> None:
        try:
            count = await self.redis.eval(SCRIPT, 1, "essence:ai:workspace:minute")
        except RedisError as exc:
            raise AIUnavailable(
                "AI is paused because the rate-limit service is unavailable."
            ) from exc
        if int(count) > 8:
            raise AIUnavailable(
                "Workspace AI limit reached (8 requests/minute). Please wait a minute."
            )
