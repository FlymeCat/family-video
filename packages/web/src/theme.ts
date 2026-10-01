import { theme, type ThemeConfig } from 'antd';

/** 深色影院主题 */
export const cinemaTheme: ThemeConfig = {
  algorithm: theme.darkAlgorithm,
  token: {
    colorPrimary: '#e50914',
    colorBgBase: '#141419',
    colorBgLayout: '#17171d',
    colorBgContainer: '#1f1f27',
    colorBgElevated: '#26262e',
    borderRadius: 10,
    fontSize: 14,
  },
  components: {
    Layout: {
      bodyBg: '#17171d',
      headerBg: '#141419',
      siderBg: '#141419',
    },
    Menu: {
      darkItemBg: '#141419',
      darkItemSelectedBg: '#e50914',
    },
    Card: {
      colorBgContainer: '#1f1f27',
    },
  },
};
