/** 酒馆没有设置人设名时使用的默认名。 */
export const DEFAULT_PERSONA_NAME = 'User';

/**
 * 读取酒馆当前人设名，也就是 {{user}} 实际展开的值。
 * 开局姓名只读这里，保证开局写入的名字和提示词里的 {{user}} 一致。
 */
export function readPersonaName(): string {
  try {
    const name = substitudeMacros('{{user}}').trim();
    if (name && name !== '{{user}}') return name;
  } catch {
    // 宿主接口不可用时回退到 name1
  }
  try {
    return (SillyTavern.name1 ?? '').trim();
  } catch {
    return '';
  }
}

/** 人设名为空或仍是酒馆默认名时，提示玩家先去设置。 */
export function isDefaultPersonaName(name: string): boolean {
  return !name || name === DEFAULT_PERSONA_NAME;
}
