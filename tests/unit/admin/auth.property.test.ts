// 权限校验属性测试
// Property 10: 白名单权限校验一致性
// **Validates: Requirements 12.3, 12.4**

import * as fc from 'fast-check';
import { checkAdmin, requireAdmin, ERR_NO_PERMISSION, ERR_MISSING_IDENTITY } from '../../../cloudfunctions/shared/utils/adminAuth';

// ===== Mock 辅助工具 =====

/**
 * 创建 mock 数据库实例
 * @param whitelist 白名单中的 openid 集合
 */
function createMockDb(whitelist: string[]) {
  return {
    collection: (name: string) => {
      if (name === 'admin_whitelist') {
        return {
          where: (query: { openid: string }) => ({
            limit: (_n: number) => ({
              get: async () => {
                const found = whitelist.includes(query.openid);
                return {
                  data: found ? [{ openid: query.openid, _id: 'mock_id' }] : [],
                };
              },
            }),
          }),
        };
      }
      // audit_logs 集合：支持 add 操作（审计日志写入）
      return {
        add: async () => ({ _id: 'mock_log_id' }),
      };
    },
  };
}

// ===== 生成器 =====

/** 生成非空 openid（模拟真实微信 openid 格式：字母数字混合） */
const openidArb = fc.stringOf(
  fc.constantFrom(
    'a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j', 'k', 'l', 'm',
    'n', 'o', 'p', 'q', 'r', 's', 't', 'u', 'v', 'w', 'x', 'y', 'z',
    'A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M',
    'N', 'O', 'P', 'Q', 'R', 'S', 'T', 'U', 'V', 'W', 'X', 'Y', 'Z',
    '0', '1', '2', '3', '4', '5', '6', '7', '8', '9', '_', '-'
  ),
  { minLength: 10, maxLength: 40 }
);

/** 生成白名单集合（不包含空字符串） */
const whitelistArb = fc.uniqueArray(openidArb, { minLength: 0, maxLength: 20 });

// ===== Property 10: 白名单权限校验一致性 =====

describe('Property 10: 白名单权限校验一致性', () => {
  /**
   * **Validates: Requirements 12.3, 12.4**
   *
   * 对任意 openid 和 admin_whitelist 集合：
   * - checkAdmin 返回 true 当且仅当 openid 存在于 whitelist 中
   * - 不在白名单中的 openid 调用 requireAdmin 必须返回 allowed=false
   */

  it('checkAdmin 对白名单中的 openid 返回 true', async () => {
    await fc.assert(
      fc.asyncProperty(
        whitelistArb.filter(arr => arr.length > 0),
        fc.nat(),
        async (whitelist, indexSeed) => {
          // 从白名单中随机选择一个 openid
          const idx = indexSeed % whitelist.length;
          const openid = whitelist[idx];
          const db = createMockDb(whitelist);

          const result = await checkAdmin(db, openid);
          expect(result).toBe(true);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('checkAdmin 对不在白名单中的 openid 返回 false', async () => {
    await fc.assert(
      fc.asyncProperty(
        whitelistArb,
        openidArb,
        async (whitelist, openid) => {
          // 确保测试的 openid 确实不在白名单中
          fc.pre(!whitelist.includes(openid));

          const db = createMockDb(whitelist);

          const result = await checkAdmin(db, openid);
          expect(result).toBe(false);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('checkAdmin 对空字符串 openid 返回 false', async () => {
    await fc.assert(
      fc.asyncProperty(
        whitelistArb,
        async (whitelist) => {
          const db = createMockDb(whitelist);

          const result = await checkAdmin(db, '');
          expect(result).toBe(false);
        }
      ),
      { numRuns: 50 }
    );
  });

  it('requireAdmin 对白名单中的 openid 返回 allowed=true', async () => {
    await fc.assert(
      fc.asyncProperty(
        whitelistArb.filter(arr => arr.length > 0),
        fc.nat(),
        async (whitelist, indexSeed) => {
          const idx = indexSeed % whitelist.length;
          const openid = whitelist[idx];
          const db = createMockDb(whitelist);

          const result = await requireAdmin(db, openid, { action: 'test' });
          expect(result.allowed).toBe(true);
          expect(result.error).toBeUndefined();
        }
      ),
      { numRuns: 100 }
    );
  });

  it('requireAdmin 对不在白名单中的 openid 返回 allowed=false 且 errCode=NO_PERMISSION', async () => {
    await fc.assert(
      fc.asyncProperty(
        whitelistArb,
        openidArb,
        async (whitelist, openid) => {
          // 确保 openid 不在白名单中
          fc.pre(!whitelist.includes(openid));

          const db = createMockDb(whitelist);

          const result = await requireAdmin(db, openid, { action: 'test' });
          expect(result.allowed).toBe(false);
          expect(result.error).toBeDefined();
          expect(result.error!.errCode).toBe(ERR_NO_PERMISSION);
          expect(result.error!.success).toBe(false);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('requireAdmin 对空字符串 openid 返回 allowed=false 且 errCode=MISSING_IDENTITY', async () => {
    await fc.assert(
      fc.asyncProperty(
        whitelistArb,
        async (whitelist) => {
          const db = createMockDb(whitelist);

          const result = await requireAdmin(db, '', { action: 'test' });
          expect(result.allowed).toBe(false);
          expect(result.error).toBeDefined();
          expect(result.error!.errCode).toBe(ERR_MISSING_IDENTITY);
          expect(result.error!.success).toBe(false);
        }
      ),
      { numRuns: 50 }
    );
  });

  it('checkAdmin 与 requireAdmin 结果一致性：对同一 openid 两者判断结果相同', async () => {
    await fc.assert(
      fc.asyncProperty(
        whitelistArb,
        openidArb,
        async (whitelist, openid) => {
          const db = createMockDb(whitelist);

          const checkResult = await checkAdmin(db, openid);
          const requireResult = await requireAdmin(db, openid, { action: 'consistency_test' });

          // checkAdmin 返回 true 等价于 requireAdmin 返回 allowed=true
          expect(requireResult.allowed).toBe(checkResult);

          // 若不允许且 openid 非空，requireAdmin 应包含 NO_PERMISSION error
          if (!checkResult && openid) {
            expect(requireResult.error).toBeDefined();
            expect(requireResult.error!.success).toBe(false);
            expect(requireResult.error!.errCode).toBe(ERR_NO_PERMISSION);
          } else if (!checkResult && !openid) {
            expect(requireResult.error).toBeDefined();
            expect(requireResult.error!.errCode).toBe(ERR_MISSING_IDENTITY);
          } else {
            expect(requireResult.error).toBeUndefined();
          }
        }
      ),
      { numRuns: 100 }
    );
  });
});
