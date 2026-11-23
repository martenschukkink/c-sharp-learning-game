// Een while direct na een andere loop: de band van de vorige loop mag niet op de false-deur uitkomen.
window.LEVEL = {
  titel: 'Loop direct na loop',
  code: `
int a = 2;
for (int i = 0; i < 1; i++) {
    Console.WriteLine(i);
}
while (a > 1) {
    a--;
}
while (a < 3) {
    a++;
}
Console.WriteLine(a);
`
};
