"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { useRouter } from "next/navigation";

/* ═══════════════════════════════════════════════════════════════════════════
   DATA
   ═══════════════════════════════════════════════════════════════════════════ */

const PHOTOS: Record<string, string> = {
  tc: "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAA0JCgsKCA0LCgsODg0PEyAVExISEyccHhcgLikxMC4pLSwzOko+MzZGNywtQFdBRkxOUlNSMj5aYVpQYEpRUk//2wBDAQ4ODhMREyYVFSZPNS01T09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT0//wAARCAA4ADgDASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwDnMVTgeSfUvLTgKwXNX8VlabLvvyNwUBiST9aJbBT3PTtJhc26eZI5OOfrWvFBgHM0hz2zWTo1zEYVXzEYjrhsmtUyr5g+fC1hc6+VFTUNPhlUnYCcda4PxDpUcFt9oi4IPzD0OcGvR3liZflkRs+jCuN8U7DYXAz8ysMj2PQ1cNzOqtDhqKDRWhgbFyzJayuhwyoSKzdJglunSSJFJRsMO2T0JrUlUvE6f3lI/SsjQrk2uoojDKs2GBolsFO1zrdWt2srWOV5Nsh/uIq4/EVt21i5S1SSd5VmiJXcc/PjP8s/lXN+J5olW1XJQHknlq7S1eCextogVkO1egzg4657VlzaHUoEUOm3NvG2WikUnhWjAI/EVh6pY/bLxlYt5aoSEVsBucD+tdSFhaNs5JU4KsScViavcLb2F1d4AKAop98YA/Oi/YHFdTzdhhiPQ4ooorU5TdFZ11BGuq2chAVHcK5HHOa0Aahu1jkgYSMFA5DH+E9jTauiIuzuauowvNq0UKokqgfMCcY9P0rrLKK4jhAit4EwACPMP+FcHoWtwm4X7Ww8wcbz0au8t9XsPK4mT8657W0Z3ppq6LDIV3PLgNt5ANeceJLueTUZrczOYFYFY8/KDjrXeNdLe7xGpEYHLnjP0rhfFXlRXxjC/vyQxx/AuMAH3PX2/Gqpq8jOs7RMWikByM0Vqc5tBqwdU+0faD5zEoT8mOmKKKbJRLocUc18IpQMMOp7V2tvottazrMrbUA6H1oorCe510dodOTBo2lvf6hhAi5SNuvtkevtXkl5dve3c13KcvM5Y0UV004pLQ5ZScndldJME8ZFFFVZMR//9k=",
  gv: "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAA0JCgsKCA0LCgsODg0PEyAVExISEyccHhcgLikxMC4pLSwzOko+MzZGNywtQFdBRkxOUlNSMj5aYVpQYEpRUk//2wBDAQ4ODhMREyYVFSZPNS01T09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT0//wAARCAA4ADgDASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwDzCiiprSMy3kMY6u6qPxNACLH82CCT6VfttHubslYIWJA9MV2fhjTbOEtL5KmU8Fm5P/1q6kpCkZARVGOwxWLq9jpjQvqzxi8sriyl8u4jZG9DVavQvFVmlzaOyJvkAOzaMkn0rz5lKsVYEMDgg9quEuZGNSHK7CUUUVZAVd0goNSh8zAGeCezdj+eKpUUMadmejW9jLdS+db3ckasd5VTgjPOP51dktzf2USXMzlQzKWz97B4rn/DWpiS0dJZmWYDaWPp2P8AStm1tAItrs2c53biQPcA9K5pJpnbTs1oTXEVtYmEO48pA0juzccDIrzO7m+0Xc0+MeY7Pj6nNdV4wu0NhBaQqSPMLFic9B0/WuPrSlGyuc9aV3YKKKK1MRQCegp4j9TUoA7UfWgDU0KBJpGIyOAre3oa6y2sr0wiITsE6dOcfWuHsLl7G8S4jwdhyVI4YdxXqsDWxt1lR18soHB3dFIzz6cGsKt1qdNFp6HMeKNOhj0QyFeYioQ+5OK4Qx5yVNdD4l1yXVbhooG2WUbYRR/H/tH+lYeABitKaaWplVknLQrlSOooqcrmirMwU06iigAFdJdeIUbwhZ6ZbqFuMMlw4GMqDx9SRj8BRRSauNOxznNJgD3NFFMQE0UUUAf/2Q==",
  sg: "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAA0JCgsKCA0LCgsODg0PEyAVExISEyccHhcgLikxMC4pLSwzOko+MzZGNywtQFdBRkxOUlNSMj5aYVpQYEpRUk//2wBDAQ4ODhMREyYVFSZPNS01T09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT0//wAARCAA4ADgDASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwDzGiiigYoBJAAJJ6AVoTaNfwQLNNDsB6AnmrfhKJH1hZJlykSFtxHCnsa6jW9Qt7jT98TMFDFPmTHNZTm07I2p001dnnu0jg9aAOas3UeyQcghhkEHqKhUcmrTuZNDcUU8iimIioqVogse4k5qeysHufmLYQdcdadmwL3ha/Sy1MLIBsmwu4/wnPH4dq6LxVduLKKFUH+sEmCOmM4x6jmsNbSONNsKhTnrW5rtulxZwTQ6g0dpJGHaE7sI56qOPX8qmdKzTNadX3XE4u4lMsxZjzSRjOfpSSqTO/GBu6VJ5YVCT27etVymblqIwoprqADiikBMADHhhkdquaZKsImyCQGzgemKyzO2MLxV/Tc+TKzIzkkYwcE8VUfiJexoiQeYVB75FWp9RCWFpCwd/ImZtueMZB/qfzrDjm8qT5hgjsTmlluUdiTggrxz0Pr+WRVyd0JD4LdZW3ydyWNUrmTzCWX7meAPQVPNc4tyqZBfgY9KZdxLFFEmQBjn3ND2ArvIpUgdaKDGhzgkUVjdFiItW4GXZ5TnCE5PJGfrRRTj8QPYsrpkcrArKBt67RwP1px8OXpSN4SkiyMwQZwX2/eIHoMjn1NFFaT0V0KC5pWZWawuY7jddRvDg/KDx+vSobpk+6uB7Yxiiipi7xuElaViqW5zRRRU2A//2Q==",
  zz: "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAA0JCgsKCA0LCgsODg0PEyAVExISEyccHhcgLikxMC4pLSwzOko+MzZGNywtQFdBRkxOUlNSMj5aYVpQYEpRUk//2wBDAQ4ODhMREyYVFSZPNS01T09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT0//wAARCAA4ADgDASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwDlkA/i4q5p1qLvUYbbdjzXCk+3eqWDxV/Trj7JfQT/APPNwxHqO9YM2R3i6VHFCyhtpPA4+6OwFY2paeluN+S7ep4roWvbeRM+YuWO4D2PSsjXbmNYmRcs47CuNt9DshpuczrCRhoJk4Z1w3vxWZuJPSpZ3kkkVJMjb0HpSqg6HHNdUXoc0o6kSxkngkgUVZWMJgA0UcwuUrIM4ANWI0BAzioUUlsjpVlVZSMUSYJHW6TPaPosbXRD+VxtHUsDgf0qvrN8lpqsh27o5EG/qNpHvWFp96LO5Mc2HSfCsvpzwfwrf1v7IkHlzTBdh5TZ8wx2rCUbPU6qck15nL3xxeJKFKhgSB+GajALjcnB6U4tNf6iuxOxx7DHX+VZ9vqcGAJVeN++Blc1tGL5TnqSTkaaqzjHpRS291bSDEcyEnsTg/rRUu6BWKxmRB8zYx0GOtSuLptLN8GSKHf5agn55D3I9hVOZQ034cGuxsdHsbrw1aNcGUNsJJXkZLEn/CtJWikyYJzbRxKNuJ75r0zTYbPxT4cSW42peQL5UknuB1PqCMGuN1htNgiNra2hieM5WTb/AKwd885qz4NvhHdXdjO5EF5AwYA45UZ4+oyKtNTjdoiSdOW+po6PZ6f5FwkNyJLscSKVKkLntnqD6155cw+XcyqP4XI/Wu38P3qQ66FuYhtnGASfmUbiAfeuV1lBHrd6i9BO4H/fRograEylzK7KK8rzRRJweOKK0INe9XZJG6sQTxiujt76fStAt1mjLK5Lkg4Kg8ge2c5/GiiueSvFXOmm7TbXY5nUb8Xt35oRkwMYZ91RQTtDIsqH5o2DCiit0klYwlJyd2aly0VvO17G7NKw4y3ABORj8MVk6nMsmp3cgUN5kjMCT0yc5oopRJRRmPGfU0UUVYH/2Q==",
  jb: "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAA0JCgsKCA0LCgsODg0PEyAVExISEyccHhcgLikxMC4pLSwzOko+MzZGNywtQFdBRkxOUlNSMj5aYVpQYEpRUk//2wBDAQ4ODhMREyYVFSZPNS01T09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT0//wAARCAA4ADgDASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwDmETnr+lXIo+Oo/KoYUJPQ1O9zBbjEj4b+6OTWGrOjRGho9mJtTgkEoWSFtwXHDAgg/wAxW1rkk0kMdo7QCSVX5zwcdBXJ6fqYfV7RUHlxmZVZ25IBOM4rpfFFpdRLGkdq73KZYELlAB/Fu9B6VMoSvqa06kbHH6bEyW7BiMGQleO1ZT/fb6mrFtqUq7UdFZF4BHB4qq5w3PU5NbKLW5zuSewCRkPynFFMNFMlnSiWKEgSOFJ6ZrJuHWS5kkzwznB9ulF7cPI8jOqrwoGO/WqlwTHHE2enJ5opLW5VTZFwRhQWUnI5H1r0LW7xLmO1uXyV+xmbfnq7RnaPpnPFedRTBxgHtXTG4Nx4Us2z92Ep/wB85FayMkcltCKqjqSBUc5ywcfd3ED+VNvpSkqqp5Xmn+WGsVwegpPsBEWoqIRzMu5RuA647UVmWaWqNFH5scAGwN8rdyO1VrlZJIR0IA7U+eNpjtU8k1Z0m3SfVLayuLjyY5HCvIcYUeuKdPYdXczrTzDkrnC8V01vKYfCsCOpJ/eMPoS1Raj4Yhu4Y5dCmXIJDLLJy3PBz0B9uKybm11bTkVL9JUjX5cM4Zc+lL2qY1RkY1yGMxcnO7mplk2wDPPt61fE1u2A9lbEj2YH9DVW5ER/1duiL6Bif5mj2iD2MizqesWt3Z2sUGm29vLEMSOigeYfXjn8KKzZGUqB5ajHcZyaKNCWpItxTeXNu9ulV7rmRj2bkUUVUPhHV+IXTr26sZzJaPtJGCD0I9xW7calJLYfaGljQHhoo4wMv7dfzooqGk2VFtR0ZzrCWVycZLHOBTxZz5BbA+poop3Fyq5MLbbDLvwzFPlx2OR/TNFFFFybH//Z",
  db: "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAA0JCgsKCA0LCgsODg0PEyAVExISEyccHhcgLikxMC4pLSwzOko+MzZGNywtQFdBRkxOUlNSMj5aYVpQYEpRUk//2wBDAQ4ODhMREyYVFSZPNS01T09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT0//wAARCAA4ADgDASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwDilWpVWkUVKopneja8KzG3vZWWB5nKrhV6kZrp9cklvbCRFtCsflnezMMr+Fcjo119mvY90nlKSR5gHK5/pW9cyW1tamWXUDMzoQsYfO49gB1A61hJO4npucbPbPbsIpSC4UE49xmq7rVuVmkcu7FmPUnvUDith2KjrRUjiimQW1FNmuY4DtbJbGcCpFFZl22buQ9cED9KcVdhVm4RuixHeyfa4ZcDZG4bb6/Wuq1G1Njpk95HaW8e9CvD5K7umPzrjkAx7Gus1i/E/gzTxkb5HCN/wAHP9K3jGNtUcM5yb3OVS5liAU4ZR0z1qxFOswbAKkdRVKVguSfwFPtWxOMn76kVnKKNqVSV0mWHFFOcUVmdLLK1jnLu3GS7HA9cmtcGsYMUl5OGRuPYg1UTLEbI2ZvDurWkaM1sZARz5R3FT6GqtzJcxW8dvcRsnku7BT6nGf5VuR+Nr1bba1vbtL/z0yR+lc9e6g19fSTum0ysWCoMgZ9PxqouSXvHPLlv7pc0D+zFu3utWcGOL7kRUtvPrgdQKh1m5gn1iSe0AERYFSFK545OP/1VnGdDn3oUtKQqgnPejS97jTdrI0noppPFFZnYyxms+/ijCmQDDsQM560UUIVT4WU1jPqDVi2nktblJ02llzjdzjjFFFapWOFlVkGeDxVuyf8AdFfQ0UVEkjWk/eLBNFFFSdJ//9k=",
  km: "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAA0JCgsKCA0LCgsODg0PEyAVExISEyccHhcgLikxMC4pLSwzOko+MzZGNywtQFdBRkxOUlNSMj5aYVpQYEpRUk//2wBDAQ4ODhMREyYVFSZPNS01T09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT0//wAARCAA4ADgDASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwDp7FD5cRPJUYrSEIdMHsaigQAD6VehPFDZso8qucx4svZtK0Jltcie4lEKOP4M5JP1wK4qDwzrF2n2kzkOOdxk5H49al8Zy6kvi101F3W2Z/8ARhn5AnYgeueveuo0iW9ktXhja2LRlQSOCQRnp61nJtbFJKbbYzwvLeahplwl+S01rKYPM7sAPX1HrVq8sUWLbxuJ5PenaDfWS3V1pReNLhJd7EkASs3Xb9K17u3QqBVRYpJbHAyReXIwA4D4orXv7MJKdo/i5oq7HOzqkwME9a5/xtr0ukWUUNnIUurg5BA6IOv59KvrfxsiNuGD0Oa4rxdefatftolTctumD9Sc/wCFSdNR2ic/ey3OpTyTXcj3Dw8cvz14ArZ0PxAtsk6yRhpmHDk4JwPT2+uKwoV8x7kJjcoDg544xT3bI3nlyAucY69f0ocVLcxhNx2LFvJefalv7XPn+dlW9GJ7/nW5p3ijUItRtY7u5MtoG8lw2O/fPqCRWAA8dru2uoYISMYB3EEc1VVjIpRcCTLHrySWJ/TFMm56jd4aYjHf+VFUNMvPtul2tyzlneP5yf7w4P6iirE3qYDan9lVlMgxs3jvgj/GuYubi4md7lzukdt7MPWrLSq4kMgUB1Ix/dHpUNrCp3B2c/3cjbx6gGoBsis5ShYnpIcH2qV5HVQCowCDkVZSxgDbxuJ92qTyECsADg9QGNMZNeTpdaZaw2yAzykJgdVCA/45rJvYmj1GRY2GMkhue/NWd32YiSMurLnDA8jIwao53SosKsXY8D7xJoEdR4SunMlzaZLDaJVGePQ4+vFFaPhrS7e2BuTZgStlWV5G4GfSiqRLZz1prUCag8tzDugY52gAsCBgEHsf8aLaCTVb2VtPgmZIweGYYAJyBjoPoKKKkNtS+NC1P/n2b/vof404aHqh/wCXVv8Avpf8aKKdguNl0DUWUhrU4/3l/wAam0zToV09rSW5ghuGychcOpzx8+Rn6UUUBclX7Tpybbm4BUk7JPM3buB+NFFFAWP/2Q==",
  gr: "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAA0JCgsKCA0LCgsODg0PEyAVExISEyccHhcgLikxMC4pLSwzOko+MzZGNywtQFdBRkxOUlNSMj5aYVpQYEpRUk//2wBDAQ4ODhMREyYVFSZPNS01T09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT0//wAARCAA4ADgDASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwDjQtWYVm3bbZHaTGTtHaogK63wfDGltc3LgZZwmT6AZ/rWc3ZGtNXZydxZXhAf7Oyr171SZHidQ4IHcmvS9RvLJ2w88SbRwCRXMa0sMluzRhZPRl5rPmNXTW5zMMp37S2c1ZK5qq0Q+9jBq3AD5XPatEzBoYVoqVl4oqhEgrf8N2rzMJlO1IJQZDuPK46Y6c1g1e/tGS20M29vM8MrTliykYIwMZqZ7F037xsjQo5/tM0B/fMcAk/c+nBqKHSBZ5Esofd1UDis7TPEYtYJYryaR5XbJbjA49KlbVDLKCpyD0rKV7HReO5W1HS0iaSdSPJBGF71UZER3VBgcHH4VtMBPIq5G3O45GaxnUrJJnqWOadNtmVRJIiYUUNRWxkWHiq3pE0UEswnl8kNGdsgAypHpn1p21SPasi9XzmI/gHQUnroC0d0XtVudMUlvtJupW5LOoP8qyFvwPlj6+9VZLZkO5V4H61aubA2w3c4bBU+oIzUtJFqTZr6dctjH3pHIAqS9MKXLbG3g/ex0BrItrv7P8i8yNx/u/8A160RANgZmySOg7VMY2dwlO6sVpBg8dKKZcnyckdO9Famdydr4EbFb60RqJTiiikxojvAvReg4qpd6pdSWkVszIFjG0MF+bHpiiihJCbaM6Jtkqseea3heqUyuB7UUVTRJnXk+8kE0UUUAf/Z",
  ji: "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAA0JCgsKCA0LCgsODg0PEyAVExISEyccHhcgLikxMC4pLSwzOko+MzZGNywtQFdBRkxOUlNSMj5aYVpQYEpRUk//2wBDAQ4ODhMREyYVFSZPNS01T09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT0//wAARCAA4ADgDASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwCYiobpzDazSjqiMw+oFWCKyvEVy1tpT7U3eafKJzjbkHmgDk9Pf/SVdjyTzmvRNCGyRHx8p6GvOdPjaWfagOccYx/Wuq8NzX01zPbjaGtkLYz972FAHd3oDRZPGa5EgJqFzGo+XIb8eurSsr7U5lKXMEmAQFKqGX8TnNVbuPy7yWU4xgKcdck0AR4op2KKAJzVDWrRrzS5oY/v4DL7kHOK0SKqajc/Y7GWcY3Kvyg9zQBxmk3EcHmeYqkAZGRW54Mv4I9Uu5Z3KmRPlAUt/KuXxuLBedx7VveHkltp13RSI+cg+USQPzHFAHoMN5E0Un+jiO5jO1wR+R/GsW4G643HPTn068VaM2MmVlLFeGHBx6GobG3kvXnnUHY8bbPqjAfrk0AQ0UpBVirgqw7GigDAvvEF2x2W0AgByNz8t/gKz7DN5eefeymRUYbt/wA2fYDua6OaC1SWQPhVQtIN3ZWIzXHQ3KwSnapZASVwcYPY0Ad1aNCkY2wJDkZ2JGNw+pq3AGIG2bBU5QKSWU/j1HtWJpN0b+zZnZokXjCevuazLoyNOLmO2uEt/mzJLJncQcZx1HIIoA6Cc311fi3bBeRtqBf4j6n0967CC2hsLeK0hGQibAfXuT+JNcPo+oMkiK8zLIf9XKD83+6T3/8A111FhqqzT7bh03BSFdT8rnPT2NADL2BJZghXJIJJ9KKtpH/pbO3QrtooA818Q6isjC3gfdtXbI4P3hwcfpXOMxLYFFFAHT2kg0UCGU/ury0EnPPzEEEfnVu1mj+2RyTXUTQ3KtlFH3SSM5Hv/jRRQBlXyxRNPDbu6PExdSDlcfzFX9HvRKyRvhfkVGX36A/y/OiigDqbfVWFvLa3JzcPgRP/AHue/vRRRQB//9k=",
  cv: "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAA0JCgsKCA0LCgsODg0PEyAVExISEyccHhcgLikxMC4pLSwzOko+MzZGNywtQFdBRkxOUlNSMj5aYVpQYEpRUk//2wBDAQ4ODhMREyYVFSZPNS01T09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT0//wAARCAA4ADgDASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwDz2lA54opUbY4b0OazOs6/RPCP2zT0ubltivyMDkj+lVNW8M2tqP3TyZ9Sa7KPUUhSztYYs+Yi4wenA7Vg6tdTTvOTHlY3Maqoycjueazk30FFJ7nDPFJC5jkHI6H1pprSvreSW6I4Bxnms09atO4JDaKU0UwH0UUUDPVtNu45dEtbgeWWESjcx4BxzmuXF3JDd3W50BlZmUCqPhW+C3cenTDMM0gIyM/NV7W1t45JJI5i8vRQP4TUSjdCUuV2MK5utlzI5JZivH1rMNTXSlHRScufmb2HaocVUVYFK+ghooNFMY+tO20ouoaZiP8AZFUbZQ91Ep6FwP1rqYxujVvUA1rTgnuYV6jjZIzblF06yaa2ULKpBDd85rR8RanZosEzLummiWRYQMYyM8n61n68P9GiX+9IP0BrAihM9yqclM4yTTqQTZlCbSuWoLaSWMzyZLOdxNTx26vnjIrSijAjGBxSRAFWI+7/AA/SqUEQ5sy5bEYJXINFaF24jjJHWik4xLjUnYztLj8zUIhj7p3H8K6SIARgenFFFOlsLEP3jN18kQQEf3z/ACrP06P95wOi/wA/8miiqe5mvhNZ/lQL68VFJKscTN2UcUUUMSKlySYkBPJGaKKKiW5pHY//2Q==",
};

interface Executive {
  id: string;
  name: string;
  role: string;
}

const EXECUTIVES: Executive[] = [
  { id: "tc", name: "Tim Cook", role: "COO" },
  { id: "gv", name: "Gary Vee", role: "CMO" },
  { id: "sg", name: "Seth Godin", role: "Brand" },
  { id: "zz", name: "Zig Ziglar", role: "Relations" },
  { id: "jb", name: "Belfort", role: "Closing" },
  { id: "db", name: "Boies", role: "Legal" },
  { id: "km", name: "Mitnick", role: "Cyber" },
  { id: "gr", name: "Guillermo", role: "CTO" },
  { id: "ji", name: "Jony Ive", role: "Design" },
  { id: "cv", name: "Chris Voss", role: "Deals" },
];

interface MetricData {
  label: string;
  value: number;
  suffix: string;
}

const METRICS: MetricData[] = [
  { label: "Intel Deployed", value: 14, suffix: "" },
  { label: "Active Missions", value: 1, suffix: "" },
  { label: "Island Zones", value: 26, suffix: "" },
  { label: "Fleet Assets", value: 50, suffix: "+" },
];

interface PipelineItem {
  name: string;
  status: "green" | "amber" | "red";
  phase: string;
}

const PIPELINE: PipelineItem[] = [
  { name: "ATHENA-7 Acquisition", status: "green", phase: "Final Review" },
  { name: "POSEIDON Charter Seq", status: "green", phase: "Active" },
  { name: "CYCLONE Refit Intel", status: "amber", phase: "Pending" },
  { name: "HYDRA Network Deploy", status: "green", phase: "Phase 2" },
  { name: "TITAN Hull Survey", status: "red", phase: "Blocked" },
  { name: "ORACLE Market Scan", status: "green", phase: "Complete" },
];

interface SystemItem {
  name: string;
  status: string;
  load: number;
}

const SYSTEMS: SystemItem[] = [
  { name: "CRM Matrix", status: "ONLINE", load: 94 },
  { name: "Email Relay", status: "ONLINE", load: 87 },
  { name: "Fleet Tracker", status: "ONLINE", load: 99 },
  { name: "Threat Grid", status: "STANDBY", load: 42 },
  { name: "Sat Uplink", status: "ONLINE", load: 78 },
  { name: "Neural Net", status: "TRAINING", load: 63 },
];

interface ThreatItem {
  vector: string;
  severity: "LOW" | "MED" | "HIGH" | "CRIT";
  detail: string;
}

const THREATS: ThreatItem[] = [
  { vector: "PERIMETER", severity: "LOW", detail: "All zones nominal" },
  { vector: "CYBER", severity: "MED", detail: "3 probes deflected" },
  { vector: "MARKET", severity: "HIGH", detail: "Competitor surge detected" },
  { vector: "WEATHER", severity: "LOW", detail: "Med Sea: calm" },
  { vector: "SUPPLY", severity: "MED", detail: "Parts delay: 48h" },
  { vector: "INTEL", severity: "CRIT", detail: "Leak risk — monitor" },
];

const LOG_ENTRIES: { tag: string; color: string; msg: string }[] = [
  { tag: "[OK]", color: "#00ff88", msg: "CRM sync complete — 14 contacts updated" },
  { tag: "[>>]", color: "#00ffc8", msg: "Fleet telemetry stream active on ch.7" },
  { tag: "[!!]", color: "#ffaa00", msg: "Email relay latency spike — 340ms" },
  { tag: "[OK]", color: "#00ff88", msg: "Threat grid scan complete — no anomalies" },
  { tag: "[>>]", color: "#00ffc8", msg: "Satellite handshake confirmed — Iridium 9" },
  { tag: "[!!]", color: "#ffaa00", msg: "Market feed delay — fallback to cache" },
  { tag: "[OK]", color: "#00ff88", msg: "Neural net inference batch 47 complete" },
  { tag: "[>>]", color: "#00ffc8", msg: "Encrypted channel established — AES-256" },
  { tag: "[OK]", color: "#00ff88", msg: "Charter pipeline updated — 3 new leads" },
  { tag: "[!!]", color: "#ffaa00", msg: "Port auth beacon intermittent — retrying" },
  { tag: "[OK]", color: "#00ff88", msg: "Backup rotation complete — 12 nodes" },
  { tag: "[>>]", color: "#00ffc8", msg: "Incoming signal — decryption in progress" },
  { tag: "[OK]", color: "#00ff88", msg: "All systems nominal — uptime 99.97%" },
  { tag: "[!!]", color: "#ffaa00", msg: "DNS resolution slow — alternate route active" },
  { tag: "[>>]", color: "#00ffc8", msg: "Agent Biniaris authenticated — level 5 clearance" },
];

/* ═══════════════════════════════════════════════════════════════════════════
   COMPONENT
   ═══════════════════════════════════════════════════════════════════════════ */

export default function CommandCenter() {
  const router = useRouter();

  // Refs for canvases
  const matrixRef = useRef<HTMLCanvasElement>(null);
  const hexRef = useRef<HTMLCanvasElement>(null);
  const particleRef = useRef<HTMLCanvasElement>(null);
  const terminalRef = useRef<HTMLDivElement>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const ambientTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // State
  const [metricCounts, setMetricCounts] = useState<number[]>([0, 0, 0, 0]);
  const [logLines, setLogLines] = useState<{ ts: string; tag: string; color: string; msg: string }[]>([]);
  const [glowCard, setGlowCard] = useState<number | null>(null);
  const [hoveredExec, setHoveredExec] = useState<string | null>(null);

  // ─── Audio helpers ──────────────────────────────────────────────────────
  const getAudioCtx = useCallback(() => {
    if (!audioCtxRef.current) {
      try {
        audioCtxRef.current = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
      } catch {
        // Audio not supported
      }
    }
    return audioCtxRef.current;
  }, []);

  const playTone = useCallback(
    (freq: number, duration: number, vol: number = 0.06) => {
      const ctx = getAudioCtx();
      if (!ctx) return;
      try {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = "sine";
        osc.frequency.setValueAtTime(freq, ctx.currentTime);
        osc.frequency.exponentialRampToValueAtTime(freq * 1.5, ctx.currentTime + duration);
        gain.gain.setValueAtTime(vol, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start();
        osc.stop(ctx.currentTime + duration);
      } catch {
        // Ignore audio errors
      }
    },
    [getAudioCtx]
  );

  const playBlip = useCallback(() => {
    playTone(1400, 0.08, 0.04);
  }, [playTone]);

  const playExecHover = useCallback(
    (index: number) => {
      playTone(300 + index * 80, 0.15, 0.05);
    },
    [playTone]
  );

  // ─── Metric count-up animation ─────────────────────────────────────────
  useEffect(() => {
    const start = performance.now();
    const duration = 2000;
    let raf: number;
    function tick(now: number) {
      const p = Math.min((now - start) / duration, 1);
      const eased = 1 - Math.pow(1 - p, 3);
      setMetricCounts(METRICS.map((m) => Math.round(m.value * eased)));
      if (p < 1) raf = requestAnimationFrame(tick);
    }
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  // ─── Terminal log cycling ──────────────────────────────────────────────
  useEffect(() => {
    let idx = 0;
    const addLine = () => {
      const entry = LOG_ENTRIES[idx % LOG_ENTRIES.length];
      const now = new Date();
      const ts = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}:${String(now.getSeconds()).padStart(2, "0")}`;
      setLogLines((prev) => [...prev.slice(-30), { ts, tag: entry.tag, color: entry.color, msg: entry.msg }]);
      idx++;
    };
    // Add a few initial lines
    for (let i = 0; i < 5; i++) {
      const entry = LOG_ENTRIES[i];
      const ts = "00:00:0" + i;
      setLogLines((prev) => [...prev, { ts, tag: entry.tag, color: entry.color, msg: entry.msg }]);
      idx++;
    }
    const timer = setInterval(addLine, 2500);
    return () => clearInterval(timer);
  }, []);

  // Auto-scroll terminal
  useEffect(() => {
    if (terminalRef.current) {
      terminalRef.current.scrollTop = terminalRef.current.scrollHeight;
    }
  }, [logLines]);

  // ─── Ambient sound ─────────────────────────────────────────────────────
  useEffect(() => {
    ambientTimerRef.current = setInterval(() => {
      playTone(80, 1.5, 0.015);
    }, 8000);
    return () => {
      if (ambientTimerRef.current) clearInterval(ambientTimerRef.current);
    };
  }, [playTone]);

  // ─── Matrix Rain Canvas ────────────────────────────────────────────────
  useEffect(() => {
    const canvas = matrixRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let raf: number;
    let w = 0;
    let h = 0;
    const fontSize = 14;
    let columns = 0;
    let drops: number[] = [];

    const chars = "ABGDEZHQIKLMNXOPRSTYFCYWabgdezhqiklmnxoprstyfcyw" +
      "\u0391\u0392\u0393\u0394\u0395\u0396\u0397\u0398\u0399\u039A\u039B\u039C\u039D\u039E\u039F\u03A0\u03A1\u03A3\u03A4\u03A5\u03A6\u03A7\u03A8\u03A9" +
      "\u30A2\u30A4\u30A6\u30A8\u30AA\u30AB\u30AD\u30AF\u30B1\u30B3\u30B5\u30B7\u30B9\u30BB\u30BD\u30BF\u30C1\u30C4\u30C6\u30C8\u30CA\u30CB\u30CC\u30CD\u30CE\u30CF\u30D2\u30D5\u30D8\u30DB\u30DE\u30DF\u30E0\u30E1\u30E2\u30E4\u30E6\u30E8\u30E9\u30EA\u30EB\u30EC\u30ED\u30EF\u30F2\u30F3" +
      "\u2200\u2202\u2203\u2205\u2207\u2208\u2209\u220B\u2211\u221A\u221E\u2227\u2228\u2229\u222A\u222B";

    function resize() {
      w = canvas!.width = window.innerWidth;
      h = canvas!.height = window.innerHeight;
      columns = Math.floor(w / fontSize);
      drops = Array.from({ length: columns }, () => Math.random() * -100);
    }

    function draw() {
      ctx!.fillStyle = "rgba(1, 8, 16, 0.06)";
      ctx!.fillRect(0, 0, w, h);
      ctx!.fillStyle = "rgba(0, 255, 200, 0.1)";
      ctx!.font = `${fontSize}px monospace`;

      for (let i = 0; i < columns; i++) {
        const char = chars[Math.floor(Math.random() * chars.length)];
        ctx!.fillText(char, i * fontSize, drops[i] * fontSize);
        if (drops[i] * fontSize > h && Math.random() > 0.975) {
          drops[i] = 0;
        }
        drops[i] += 0.5;
      }
      raf = requestAnimationFrame(draw);
    }

    resize();
    draw();
    window.addEventListener("resize", resize);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
    };
  }, []);

  // ─── Hex Grid Canvas ───────────────────────────────────────────────────
  useEffect(() => {
    const canvas = hexRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let raf: number;
    let w = 0;
    let h = 0;

    function resize() {
      w = canvas!.width = window.innerWidth;
      h = canvas!.height = window.innerHeight;
    }

    function drawHex(cx: number, cy: number, r: number) {
      ctx!.beginPath();
      for (let i = 0; i < 6; i++) {
        const angle = (Math.PI / 3) * i - Math.PI / 6;
        const x = cx + r * Math.cos(angle);
        const y = cy + r * Math.sin(angle);
        if (i === 0) ctx!.moveTo(x, y);
        else ctx!.lineTo(x, y);
      }
      ctx!.closePath();
      ctx!.stroke();
    }

    function draw() {
      ctx!.clearRect(0, 0, w, h);
      ctx!.strokeStyle = "rgba(0, 255, 200, 0.04)";
      ctx!.lineWidth = 0.5;
      const size = 30;
      const hDist = size * Math.sqrt(3);
      const vDist = size * 1.5;

      for (let row = -1; row < h / vDist + 1; row++) {
        for (let col = -1; col < w / hDist + 1; col++) {
          const offset = row % 2 === 0 ? 0 : hDist / 2;
          drawHex(col * hDist + offset, row * vDist, size);
        }
      }
      raf = requestAnimationFrame(draw);
    }

    resize();
    draw();
    window.addEventListener("resize", resize);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
    };
  }, []);

  // ─── Particle Neural Network Canvas ────────────────────────────────────
  useEffect(() => {
    const canvas = particleRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let raf: number;
    let w = 0;
    let h = 0;

    interface Particle {
      x: number;
      y: number;
      vx: number;
      vy: number;
    }

    const particles: Particle[] = [];
    const COUNT = 150;
    const MAX_DIST = 120;

    function resize() {
      w = canvas!.width = window.innerWidth;
      h = canvas!.height = window.innerHeight;
    }

    function init() {
      particles.length = 0;
      for (let i = 0; i < COUNT; i++) {
        particles.push({
          x: Math.random() * w,
          y: Math.random() * h,
          vx: (Math.random() - 0.5) * 0.5,
          vy: (Math.random() - 0.5) * 0.5,
        });
      }
    }

    function draw() {
      ctx!.clearRect(0, 0, w, h);

      for (const p of particles) {
        p.x += p.vx;
        p.y += p.vy;
        if (p.x < 0) p.x = w;
        if (p.x > w) p.x = 0;
        if (p.y < 0) p.y = h;
        if (p.y > h) p.y = 0;

        ctx!.beginPath();
        ctx!.arc(p.x, p.y, 1.5, 0, Math.PI * 2);
        ctx!.fillStyle = "rgba(0, 255, 200, 0.3)";
        ctx!.fill();
      }

      for (let i = 0; i < particles.length; i++) {
        for (let j = i + 1; j < particles.length; j++) {
          const dx = particles[i].x - particles[j].x;
          const dy = particles[i].y - particles[j].y;
          const dist = Math.sqrt(dx * dx + dy * dy);
          if (dist < MAX_DIST) {
            ctx!.beginPath();
            ctx!.moveTo(particles[i].x, particles[i].y);
            ctx!.lineTo(particles[j].x, particles[j].y);
            ctx!.strokeStyle = `rgba(0, 255, 200, ${0.15 * (1 - dist / MAX_DIST)})`;
            ctx!.lineWidth = 0.5;
            ctx!.stroke();
          }
        }
      }

      raf = requestAnimationFrame(draw);
    }

    resize();
    init();
    draw();

    const handleResize = () => {
      resize();
      init();
    };

    window.addEventListener("resize", handleResize);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", handleResize);
    };
  }, []);

  // ─── Metric glow explosion ─────────────────────────────────────────────
  const handleMetricClick = (idx: number) => {
    playBlip();
    setGlowCard(idx);
    setTimeout(() => setGlowCard(null), 600);
  };

  // ─── Status color helper ───────────────────────────────────────────────
  const statusDot = (s: string) => {
    if (s === "green") return "#00ff88";
    if (s === "amber") return "#ffaa00";
    if (s === "red") return "#ff3366";
    return "#00ffc8";
  };

  const severityColor = (s: string) => {
    if (s === "LOW") return "#00ff88";
    if (s === "MED") return "#ffaa00";
    if (s === "HIGH") return "#ff6644";
    if (s === "CRIT") return "#ff0064";
    return "#00ffc8";
  };

  /* ═════════════════════════════════════════════════════════════════════════
     RENDER
     ═════════════════════════════════════════════════════════════════════════ */

  return (
    <>
      {/* ── STYLE TAG ────────────────────────────────────────────────────── */}
      <style>{`
        @keyframes cc-scanline {
          0% { background-position: 0 0; }
          100% { background-position: 0 4px; }
        }
        @keyframes cc-scan-beam-1 {
          0% { top: -2px; }
          100% { top: 100%; }
        }
        @keyframes cc-scan-beam-2 {
          0% { top: -2px; }
          100% { top: 100%; }
        }
        @keyframes cc-scan-beam-3 {
          0% { top: -2px; }
          100% { top: 100%; }
        }
        @keyframes cc-noise {
          0% { opacity: 0.02; }
          10% { opacity: 0.04; }
          20% { opacity: 0.01; }
          30% { opacity: 0.03; }
          40% { opacity: 0.02; }
          50% { opacity: 0.05; }
          60% { opacity: 0.01; }
          70% { opacity: 0.03; }
          80% { opacity: 0.02; }
          90% { opacity: 0.04; }
          100% { opacity: 0.02; }
        }
        @keyframes cc-blink {
          0%, 49% { opacity: 1; }
          50%, 100% { opacity: 0; }
        }
        @keyframes cc-cursor-blink {
          0%, 49% { opacity: 1; }
          50%, 100% { opacity: 0; }
        }
        @keyframes cc-shimmer {
          0% { left: -100%; }
          100% { left: 200%; }
        }
        @keyframes cc-fill-bar {
          0% { width: 0%; }
          100% { width: var(--bar-w); }
        }
        @keyframes cc-glow-explode {
          0% { box-shadow: 0 0 0px #00ffc8, inset 0 0 0px #00ffc8; }
          50% { box-shadow: 0 0 40px #00ffc8, inset 0 0 20px rgba(0,255,200,0.3); }
          100% { box-shadow: 0 0 0px #00ffc8, inset 0 0 0px #00ffc8; }
        }
        @keyframes cc-wave-1 {
          0% { d: path("M0 30 Q 60 10, 120 30 T 240 30 T 360 30 T 480 30"); }
          50% { d: path("M0 30 Q 60 50, 120 30 T 240 30 T 360 30 T 480 30"); }
          100% { d: path("M0 30 Q 60 10, 120 30 T 240 30 T 360 30 T 480 30"); }
        }
        @keyframes cc-radar-sweep {
          0% { transform: rotate(0deg); }
          100% { transform: rotate(360deg); }
        }
        @keyframes cc-orbit {
          0% { transform: rotate(0deg) translateX(28px) rotate(0deg); }
          100% { transform: rotate(360deg) translateX(28px) rotate(-360deg); }
        }
        @keyframes cc-pulse-ring {
          0% { transform: scale(1); opacity: 0.6; }
          100% { transform: scale(2.5); opacity: 0; }
        }
        .cc-card-glow {
          animation: cc-glow-explode 0.6s ease-out;
        }
      `}</style>

      {/* ── MAIN CONTAINER ───────────────────────────────────────────────── */}
      <div
        style={{
          position: "relative",
          minHeight: "100vh",
          background: "#010810",
          fontFamily: "monospace",
          color: "#a0ffe0",
          overflow: "hidden",
        }}
      >
        {/* ── CANVAS LAYERS ──────────────────────────────────────────────── */}
        <canvas
          ref={matrixRef}
          style={{ position: "fixed", inset: 0, width: "100%", height: "100%", zIndex: 1, pointerEvents: "none" }}
        />
        <canvas
          ref={hexRef}
          style={{ position: "fixed", inset: 0, width: "100%", height: "100%", zIndex: 2, pointerEvents: "none" }}
        />
        <canvas
          ref={particleRef}
          style={{ position: "fixed", inset: 0, width: "100%", height: "100%", zIndex: 3, pointerEvents: "none" }}
        />

        {/* ── CRT SCANLINES ──────────────────────────────────────────────── */}
        <div
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 4,
            pointerEvents: "none",
            background: "repeating-linear-gradient(0deg, rgba(0,0,0,0.15) 0px, rgba(0,0,0,0.15) 1px, transparent 1px, transparent 3px)",
            animation: "cc-scanline 0.1s linear infinite",
          }}
        />

        {/* ── SCAN BEAMS ─────────────────────────────────────────────────── */}
        <div
          style={{
            position: "fixed",
            left: 0,
            right: 0,
            height: "2px",
            background: "linear-gradient(90deg, transparent 0%, #00ffc8 50%, transparent 100%)",
            opacity: 0.4,
            zIndex: 5,
            pointerEvents: "none",
            animation: "cc-scan-beam-1 4s linear infinite",
          }}
        />
        <div
          style={{
            position: "fixed",
            left: 0,
            right: 0,
            height: "1px",
            background: "linear-gradient(90deg, transparent 0%, rgba(255,0,100,0.6) 50%, transparent 100%)",
            opacity: 0.3,
            zIndex: 5,
            pointerEvents: "none",
            animation: "cc-scan-beam-2 6s linear infinite",
          }}
        />
        <div
          style={{
            position: "fixed",
            left: 0,
            right: 0,
            height: "1px",
            background: "linear-gradient(90deg, transparent 0%, rgba(0,100,255,0.6) 50%, transparent 100%)",
            opacity: 0.3,
            zIndex: 5,
            pointerEvents: "none",
            animation: "cc-scan-beam-3 8s linear infinite",
          }}
        />

        {/* ── TV NOISE OVERLAY ───────────────────────────────────────────── */}
        <div
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 6,
            pointerEvents: "none",
            backgroundImage:
              "url(\"data:image/svg+xml,%3Csvg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)' opacity='0.08'/%3E%3C/svg%3E\")",
            backgroundSize: "200px 200px",
            animation: "cc-noise 0.3s steps(5) infinite",
          }}
        />

        {/* ── CORNER BRACKETS (HUD CORNERS) ──────────────────────────────── */}
        {/* Top-left */}
        <svg
          style={{ position: "fixed", top: 8, left: 8, zIndex: 7, pointerEvents: "none" }}
          width="40"
          height="40"
          viewBox="0 0 40 40"
        >
          <path d="M0 15 L0 0 L15 0" fill="none" stroke="#00ffc8" strokeWidth="1.5" opacity="0.5" />
        </svg>
        {/* Top-right */}
        <svg
          style={{ position: "fixed", top: 8, right: 8, zIndex: 7, pointerEvents: "none" }}
          width="40"
          height="40"
          viewBox="0 0 40 40"
        >
          <path d="M25 0 L40 0 L40 15" fill="none" stroke="#00ffc8" strokeWidth="1.5" opacity="0.5" />
        </svg>
        {/* Bottom-left */}
        <svg
          style={{ position: "fixed", bottom: 8, left: 8, zIndex: 7, pointerEvents: "none" }}
          width="40"
          height="40"
          viewBox="0 0 40 40"
        >
          <path d="M0 25 L0 40 L15 40" fill="none" stroke="#00ffc8" strokeWidth="1.5" opacity="0.5" />
        </svg>
        {/* Bottom-right */}
        <svg
          style={{ position: "fixed", bottom: 8, right: 8, zIndex: 7, pointerEvents: "none" }}
          width="40"
          height="40"
          viewBox="0 0 40 40"
        >
          <path d="M25 40 L40 40 L40 25" fill="none" stroke="#00ffc8" strokeWidth="1.5" opacity="0.5" />
        </svg>

        {/* ── CONTENT ────────────────────────────────────────────────────── */}
        <div
          style={{
            position: "relative",
            zIndex: 10,
            maxWidth: 1200,
            margin: "0 auto",
            padding: "24px 16px 60px",
          }}
        >
          {/* ── HEADER ──────────────────────────────────────────────────── */}
          <header style={{ textAlign: "center", marginBottom: 40 }}>
            {/* CLASSIFIED tag */}
            <div
              style={{
                display: "inline-block",
                padding: "2px 16px",
                border: "1px solid rgba(255,0,100,0.5)",
                fontSize: 10,
                letterSpacing: 4,
                color: "rgba(255,0,100,0.9)",
                textTransform: "uppercase",
                marginBottom: 12,
                animation: "cc-blink 1s steps(1) infinite",
              }}
            >
              CLASSIFIED
            </div>

            {/* Title with chromatic aberration */}
            <h1
              style={{
                fontSize: "clamp(18px, 3vw, 32px)",
                fontWeight: 900,
                letterSpacing: 6,
                color: "#00ffc8",
                textTransform: "uppercase",
                textShadow: "-2px 0 #ff0064, 2px 0 #0064ff, 0 0 20px rgba(0,255,200,0.5)",
                lineHeight: 1.3,
                margin: "8px 0",
              }}
            >
              GEORGE YACHTS COMMAND CENTER
            </h1>

            {/* Typing cursor */}
            <div
              style={{
                display: "inline-block",
                fontSize: 12,
                color: "#00ffc8",
                opacity: 0.6,
              }}
            >
              SYSTEM ONLINE
              <span
                style={{
                  display: "inline-block",
                  width: 8,
                  height: 14,
                  background: "#00ffc8",
                  marginLeft: 4,
                  verticalAlign: "middle",
                  animation: "cc-cursor-blink 1s steps(1) infinite",
                }}
              />
            </div>
          </header>

          {/* ── METRIC CARDS ────────────────────────────────────────────── */}
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
              gap: 16,
              marginBottom: 40,
            }}
          >
            {METRICS.map((m, idx) => (
              <div
                key={m.label}
                onClick={() => handleMetricClick(idx)}
                onMouseEnter={playBlip}
                className={glowCard === idx ? "cc-card-glow" : ""}
                style={{
                  position: "relative",
                  overflow: "hidden",
                  background: "rgba(0, 20, 40, 0.6)",
                  border: "1px solid rgba(0, 255, 200, 0.15)",
                  borderRadius: 8,
                  padding: "20px 16px",
                  cursor: "pointer",
                  transition: "border-color 0.3s, box-shadow 0.3s",
                  ...(glowCard === idx
                    ? {}
                    : {}),
                }}
                onMouseOver={(e) => {
                  (e.currentTarget as HTMLDivElement).style.borderColor = "rgba(0, 255, 200, 0.4)";
                  (e.currentTarget as HTMLDivElement).style.boxShadow = "0 0 20px rgba(0,255,200,0.15)";
                }}
                onMouseOut={(e) => {
                  (e.currentTarget as HTMLDivElement).style.borderColor = "rgba(0, 255, 200, 0.15)";
                  (e.currentTarget as HTMLDivElement).style.boxShadow = "none";
                }}
              >
                {/* Shimmer sweep */}
                <div
                  style={{
                    position: "absolute",
                    top: 0,
                    left: "-100%",
                    width: "50%",
                    height: "100%",
                    background: "linear-gradient(90deg, transparent, rgba(0,255,200,0.06), transparent)",
                    animation: "cc-shimmer 3s ease-in-out infinite",
                    pointerEvents: "none",
                  }}
                />
                <div style={{ fontSize: 10, letterSpacing: 2, color: "rgba(160,255,224,0.5)", textTransform: "uppercase", marginBottom: 8 }}>
                  {m.label}
                </div>
                <div style={{ fontSize: 36, fontWeight: 900, color: "#00ffc8", textShadow: "0 0 15px rgba(0,255,200,0.4)" }}>
                  {metricCounts[idx]}{m.suffix}
                </div>
                {/* Energy bar */}
                <div style={{ marginTop: 12, height: 3, background: "rgba(0,255,200,0.1)", borderRadius: 2, overflow: "hidden" }}>
                  <div
                    style={{
                      height: "100%",
                      background: "linear-gradient(90deg, #00ffc8, #0064ff)",
                      borderRadius: 2,
                      ["--bar-w" as string]: `${(m.value / 50) * 100}%`,
                      animation: "cc-fill-bar 2s ease-out forwards",
                      width: 0,
                    }}
                  />
                </div>
              </div>
            ))}
          </div>

          {/* ── EXECUTIVE GRID ──────────────────────────────────────────── */}
          <div style={{ marginBottom: 40 }}>
            <div style={{ fontSize: 10, letterSpacing: 3, color: "rgba(160,255,224,0.4)", textTransform: "uppercase", marginBottom: 12 }}>
              EXECUTIVE COUNCIL
            </div>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))",
                gap: 12,
              }}
            >
              {EXECUTIVES.map((exec, idx) => (
                <div
                  key={exec.id}
                  onClick={() => {
                    router.push("/dashboard/chat");
                  }}
                  onMouseEnter={() => {
                    setHoveredExec(exec.id);
                    playExecHover(idx);
                  }}
                  onMouseLeave={() => setHoveredExec(null)}
                  style={{
                    position: "relative",
                    display: "flex",
                    alignItems: "center",
                    gap: 10,
                    padding: "12px 14px",
                    background: "rgba(0, 20, 40, 0.5)",
                    border: `1px solid ${hoveredExec === exec.id ? "rgba(0, 255, 200, 0.5)" : "rgba(0, 255, 200, 0.1)"}`,
                    borderRadius: 8,
                    cursor: "pointer",
                    transition: "all 0.3s",
                    boxShadow: hoveredExec === exec.id ? "0 0 25px rgba(0,255,200,0.2)" : "none",
                    overflow: "hidden",
                  }}
                >
                  {/* Avatar */}
                  <div
                    style={{
                      position: "relative",
                      width: 44,
                      height: 44,
                      borderRadius: "50%",
                      backgroundImage: `url(${PHOTOS[exec.id]})`,
                      backgroundSize: "cover",
                      backgroundPosition: "center",
                      flexShrink: 0,
                      border: "1.5px solid rgba(0,255,200,0.3)",
                    }}
                  >
                    {/* Orbiting particle on hover */}
                    {hoveredExec === exec.id && (
                      <div
                        style={{
                          position: "absolute",
                          top: "50%",
                          left: "50%",
                          width: 4,
                          height: 4,
                          marginLeft: -2,
                          marginTop: -2,
                          borderRadius: "50%",
                          background: "#00ffc8",
                          boxShadow: "0 0 6px #00ffc8",
                          animation: "cc-orbit 1.5s linear infinite",
                        }}
                      />
                    )}
                  </div>

                  {/* Info */}
                  <div>
                    <div style={{ fontSize: 12, fontWeight: 700, color: "#a0ffe0" }}>{exec.name}</div>
                    <div style={{ fontSize: 10, color: "rgba(0,255,200,0.5)", letterSpacing: 1 }}>{exec.role.toUpperCase()}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* ── WAVEFORM + RADAR ────────────────────────────────────────── */}
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 140px",
              gap: 16,
              marginBottom: 40,
              alignItems: "center",
            }}
          >
            {/* Waveform */}
            <div
              style={{
                background: "rgba(0, 20, 40, 0.4)",
                border: "1px solid rgba(0, 255, 200, 0.1)",
                borderRadius: 8,
                padding: 16,
                overflow: "hidden",
              }}
            >
              <div style={{ fontSize: 10, letterSpacing: 2, color: "rgba(160,255,224,0.4)", marginBottom: 8 }}>
                SIGNAL WAVEFORM
              </div>
              <svg width="100%" height="60" viewBox="0 0 480 60" preserveAspectRatio="none">
                {[
                  { color: "rgba(0,255,200,0.4)", dur: "3s", amp: 12 },
                  { color: "rgba(255,0,100,0.3)", dur: "4s", amp: 8 },
                  { color: "rgba(0,100,255,0.3)", dur: "5s", amp: 15 },
                  { color: "rgba(0,255,200,0.2)", dur: "7s", amp: 6 },
                ].map((wave, i) => {
                  const points: string[] = [];
                  for (let x = 0; x <= 480; x += 4) {
                    const y = 30 + Math.sin((x / 480) * Math.PI * (3 + i) + i * 1.2) * wave.amp;
                    points.push(`${x},${y}`);
                  }
                  return (
                    <polyline
                      key={i}
                      points={points.join(" ")}
                      fill="none"
                      stroke={wave.color}
                      strokeWidth="1.5"
                    >
                      <animate
                        attributeName="points"
                        dur={wave.dur}
                        repeatCount="indefinite"
                        values={`${points.join(" ")};${points.map((p) => {
                          const [px, py] = p.split(",");
                          return `${px},${60 - parseFloat(py)}`;
                        }).join(" ")};${points.join(" ")}`}
                      />
                    </polyline>
                  );
                })}
              </svg>
            </div>

            {/* Mini Radar */}
            <div
              style={{
                background: "rgba(0, 20, 40, 0.4)",
                border: "1px solid rgba(0, 255, 200, 0.1)",
                borderRadius: 8,
                padding: 12,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <svg width="110" height="110" viewBox="0 0 110 110">
                {/* Radar circles */}
                {[20, 35, 50].map((r) => (
                  <circle key={r} cx="55" cy="55" r={r} fill="none" stroke="rgba(0,255,200,0.1)" strokeWidth="0.5" />
                ))}
                {/* Cross lines */}
                <line x1="55" y1="5" x2="55" y2="105" stroke="rgba(0,255,200,0.06)" strokeWidth="0.5" />
                <line x1="5" y1="55" x2="105" y2="55" stroke="rgba(0,255,200,0.06)" strokeWidth="0.5" />
                {/* Sweep line */}
                <line
                  x1="55"
                  y1="55"
                  x2="55"
                  y2="5"
                  stroke="rgba(0,255,200,0.6)"
                  strokeWidth="1.5"
                  style={{
                    transformOrigin: "55px 55px",
                    animation: "cc-radar-sweep 4s linear infinite",
                  }}
                />
                {/* Random blips */}
                {[
                  { cx: 35, cy: 30 },
                  { cx: 70, cy: 45 },
                  { cx: 50, cy: 75 },
                  { cx: 80, cy: 70 },
                  { cx: 25, cy: 60 },
                ].map((b, i) => (
                  <circle key={i} cx={b.cx} cy={b.cy} r="2" fill="#00ffc8" opacity={0.5 + Math.random() * 0.3}>
                    <animate attributeName="opacity" values="0.2;0.8;0.2" dur={`${2 + i * 0.5}s`} repeatCount="indefinite" />
                  </circle>
                ))}
              </svg>
            </div>
          </div>

          {/* ── 3 PANELS ────────────────────────────────────────────────── */}
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
              gap: 16,
              marginBottom: 40,
            }}
          >
            {/* Mission Pipeline */}
            <div
              style={{
                background: "rgba(0, 20, 40, 0.5)",
                border: "1px solid rgba(0, 255, 200, 0.1)",
                borderRadius: 8,
                padding: 16,
              }}
            >
              <div style={{ fontSize: 10, letterSpacing: 3, color: "rgba(160,255,224,0.4)", marginBottom: 12 }}>
                MISSION PIPELINE
              </div>
              {PIPELINE.map((p, i) => (
                <div
                  key={i}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    padding: "6px 0",
                    borderBottom: i < PIPELINE.length - 1 ? "1px solid rgba(0,255,200,0.05)" : "none",
                    fontSize: 11,
                  }}
                >
                  <div
                    style={{
                      width: 6,
                      height: 6,
                      borderRadius: "50%",
                      background: statusDot(p.status),
                      boxShadow: `0 0 6px ${statusDot(p.status)}`,
                      flexShrink: 0,
                    }}
                  />
                  <span style={{ flex: 1, color: "#a0ffe0" }}>{p.name}</span>
                  <span style={{ color: "rgba(160,255,224,0.4)", fontSize: 9, letterSpacing: 1 }}>{p.phase.toUpperCase()}</span>
                </div>
              ))}
            </div>

            {/* Systems Array */}
            <div
              style={{
                background: "rgba(0, 20, 40, 0.5)",
                border: "1px solid rgba(0, 255, 200, 0.1)",
                borderRadius: 8,
                padding: 16,
              }}
            >
              <div style={{ fontSize: 10, letterSpacing: 3, color: "rgba(160,255,224,0.4)", marginBottom: 12 }}>
                SYSTEMS ARRAY
              </div>
              {SYSTEMS.map((s, i) => (
                <div
                  key={i}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    padding: "6px 0",
                    borderBottom: i < SYSTEMS.length - 1 ? "1px solid rgba(0,255,200,0.05)" : "none",
                    fontSize: 11,
                  }}
                >
                  <span style={{ flex: 1, color: "#a0ffe0" }}>{s.name}</span>
                  <span
                    style={{
                      fontSize: 9,
                      color: s.status === "ONLINE" ? "#00ff88" : s.status === "STANDBY" ? "#ffaa00" : "#0064ff",
                      letterSpacing: 1,
                    }}
                  >
                    {s.status}
                  </span>
                  <div style={{ width: 40, height: 3, background: "rgba(0,255,200,0.1)", borderRadius: 2, overflow: "hidden" }}>
                    <div
                      style={{
                        width: `${s.load}%`,
                        height: "100%",
                        background: s.load > 90 ? "#00ff88" : s.load > 60 ? "#00ffc8" : "#0064ff",
                        borderRadius: 2,
                        transition: "width 1s",
                      }}
                    />
                  </div>
                </div>
              ))}
            </div>

            {/* Threat Monitor */}
            <div
              style={{
                background: "rgba(0, 20, 40, 0.5)",
                border: "1px solid rgba(0, 255, 200, 0.1)",
                borderRadius: 8,
                padding: 16,
              }}
            >
              <div style={{ fontSize: 10, letterSpacing: 3, color: "rgba(160,255,224,0.4)", marginBottom: 12 }}>
                THREAT MONITOR
              </div>
              {THREATS.map((t, i) => (
                <div
                  key={i}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    padding: "6px 0",
                    borderBottom: i < THREATS.length - 1 ? "1px solid rgba(0,255,200,0.05)" : "none",
                    fontSize: 11,
                  }}
                >
                  <span
                    style={{
                      fontSize: 9,
                      fontWeight: 700,
                      color: severityColor(t.severity),
                      minWidth: 30,
                      letterSpacing: 1,
                    }}
                  >
                    {t.severity}
                  </span>
                  <span style={{ fontWeight: 700, color: "#a0ffe0", minWidth: 70 }}>{t.vector}</span>
                  <span style={{ color: "rgba(160,255,224,0.4)", fontSize: 10, flex: 1 }}>{t.detail}</span>
                </div>
              ))}
            </div>
          </div>

          {/* ── LIVE TERMINAL LOG ────────────────────────────────────────── */}
          <div
            style={{
              background: "rgba(0, 10, 20, 0.8)",
              border: "1px solid rgba(0, 255, 200, 0.1)",
              borderRadius: 8,
              padding: 16,
              marginBottom: 40,
            }}
          >
            <div style={{ fontSize: 10, letterSpacing: 3, color: "rgba(160,255,224,0.4)", marginBottom: 8 }}>
              LIVE TERMINAL
            </div>
            <div
              ref={terminalRef}
              style={{
                height: 200,
                overflowY: "auto",
                fontSize: 11,
                lineHeight: 1.8,
                scrollbarWidth: "thin",
                scrollbarColor: "rgba(0,255,200,0.2) transparent",
              }}
            >
              {logLines.map((line, i) => (
                <div key={i}>
                  <span style={{ color: "rgba(160,255,224,0.3)" }}>{line.ts} </span>
                  <span style={{ color: line.color, fontWeight: 700 }}>{line.tag} </span>
                  <span style={{ color: "#a0ffe0" }}>{line.msg}</span>
                </div>
              ))}
            </div>
          </div>

          {/* ── FOOTER ──────────────────────────────────────────────────── */}
          <footer style={{ textAlign: "center", paddingBottom: 20 }}>
            <div style={{ fontSize: 10, letterSpacing: 4, color: "rgba(160,255,224,0.3)", marginBottom: 4 }}>
              GEORGE YACHTS BROKERAGE HOUSE LLC
            </div>
            <div style={{ fontSize: 9, letterSpacing: 2, color: "rgba(160,255,224,0.2)", marginBottom: 4 }}>
              AES-256 QUANTUM ENCRYPTED
            </div>
            <div style={{ fontSize: 9, letterSpacing: 2, color: "rgba(160,255,224,0.15)" }}>
              37.8034N 23.7644E
            </div>
          </footer>
        </div>
      </div>
    </>
  );
}
