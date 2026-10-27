/** 战法 ID 与美术语言的对应表。数值和命中结果仍由战报提供。 */
export type PaintedSkillFamily='cleave'|'thrust'|'fire'|'lightning'|'water'|'petals'|'poison'|'shield'|'wisdom'|'rally'|'haste'|'seal';
export interface PaintedSkillStyle {
    family:PaintedSkillFamily; tint:[number,number,number]; element:number;
    intent:'attack'|'buff'|'debuff'; variant:number; weight:number;
}
type Entry=[PaintedSkillFamily,string,('attack'|'buff'|'debuff')?,number?];
const ENTRIES:Record<number,Entry>={
    1001:['cleave','ffbe6c','attack',1.2],1002:['shield','ffe6a0','buff'],
    1003:['seal','c4a2ff','debuff'],1004:['petals','ffc2e1'],1005:['seal','ffbf9a','buff'],
    1006:['shield','ffc18f','buff'],1007:['rally','ffb291','buff'],1008:['lightning','fff0a8','attack',1.15],
    1009:['cleave','ee9dff','attack',1.15],1010:['cleave','ffb4a1'],1011:['poison','d5b1ff','debuff'],
    1012:['shield','b5ffdd','buff'],1013:['thrust','bdeaff'],1014:['water','afffe1'],
    1015:['water','d5e2ff'],1016:['rally','caffae','buff'],1017:['wisdom','a9ffec','buff'],
    1018:['fire','ffda9c','attack',1.15],1019:['thrust','ffd1ea'],1020:['wisdom','e9ffaf','buff'],
    1021:['thrust','e5d8ff'],1022:['seal','d9b7ff','buff'],1023:['cleave','baffcb','attack',1.2],
    1024:['cleave','ffce8f','attack',1.2],1025:['fire','ffb8aa','attack',1.2],1026:['thrust','fff0b5'],
    2001:['cleave','ffe5ae'],2002:['cleave','ffcf9b'],2003:['cleave','ffebc7'],2004:['cleave','ffd0a6'],
    2005:['wisdom','c8d6ff','attack'],2006:['seal','d9c4ff','attack'],2007:['poison','cec2ff','attack'],2008:['fire','ffd4a1'],
    2009:['thrust','c0efff'],2010:['cleave','ffd39b'],2011:['cleave','f1d6b5'],2012:['seal','cdadff','debuff'],
    2013:['rally','ffe6a8','buff'],2014:['shield','ffe9bd','buff'],2015:['wisdom','c3ffea','buff'],2016:['haste','b6f5ff','buff'],
    2017:['rally','ffc9ab','buff'],2018:['shield','e1d3ff','buff'],2019:['wisdom','dbd3ff','buff'],2020:['haste','cbffef','buff'],
    2021:['seal','d9b4ef','debuff'],2022:['seal','eab7ac','debuff'],2023:['poison','e9baf7','debuff'],2024:['seal','b7d4ff','debuff'],
    2025:['cleave','fff0c4'],2026:['cleave','ffc3a4'],2027:['thrust','d1dfff'],2028:['thrust','b8ffe9'],
    2029:['rally','ffd795','buff'],2030:['rally','ffeab1','buff'],2031:['shield','d7edff','buff'],2032:['wisdom','abffeb','buff'],
    2033:['haste','bcf4ff','buff'],2034:['rally','ffd6a0','buff'],2035:['shield','cde7ff','buff'],2036:['thrust','f0edcb'],
    2037:['lightning','d4e5ff'],2038:['cleave','ffd3ac'],2039:['fire','ffbd91'],2040:['seal','e4beff','buff']
};
const ELEMENT:Record<PaintedSkillFamily,number>={fire:0,lightning:1,water:2,petals:3,poison:4,shield:5,wisdom:6,rally:7,haste:8,seal:9,cleave:7,thrust:11};
export const PAINTED_SKILL_IDS=Object.keys(ENTRIES).map(Number);
const CACHE=new Map<number,PaintedSkillStyle>();
export function paintedSkillStyle(id:number):PaintedSkillStyle|null {
    const entry=ENTRIES[id];if(!entry)return null;
    if(!CACHE.has(id)){
        const [family,hex,intent='attack',weight=1]=entry;
        CACHE.set(id,{family,tint:[0,2,4].map(n=>parseInt(hex.slice(n,n+2),16)) as [number,number,number],
            intent,element:ELEMENT[family],variant:id%3,weight});
    }
    return CACHE.get(id);
}
